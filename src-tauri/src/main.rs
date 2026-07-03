// 防止 release 模式下弹出黑色控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::ffi::OsStr;
use std::fs;
use std::iter;
use std::os::windows::ffi::OsStrExt;
use std::process::Command;
use tauri::ipc::Response;

// ShellExecuteW：用系统默认程序打开 URL / 文件，避免 cmd start 的引号转义与 & 截断问题
#[link(name = "shell32")]
extern "system" {
    fn ShellExecuteW(
        hwnd: isize,
        operation: *const u16,
        file: *const u16,
        parameters: *const u16,
        directory: *const u16,
        show: i32,
    ) -> isize;
}

/// 把字符串转成以 0 结尾的 UTF-16 宽字符序列（ShellExecuteW 需要）
fn wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(iter::once(0)).collect()
}

const PROG_ID: &str = "ExchangeMD.md";
const APP_NAME: &str = "ExchangeMD.exe";
const MD_EXTS: &[&str] = &[".md", ".markdown", ".mdown"];

/// 读取文本文件（用于 .md / .html）
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("读取文件失败：{e}"))
}

/// 读取二进制文件为原始字节（用于 .docx / .xlsx），零拷贝传给前端
#[tauri::command]
fn read_file_bytes(path: String) -> Result<Response, String> {
    let bytes = fs::read(&path).map_err(|e| format!("读取文件失败：{e}"))?;
    Ok(Response::new(bytes))
}

/// 写入文本文件
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("写入文件失败：{e}"))
}

/// 写入二进制文件（用于导出 .docx）
#[tauri::command]
fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    fs::write(&path, bytes).map_err(|e| format!("写入文件失败：{e}"))
}

/// 启动时传入的文件路径（通过双击 / 右键打开时由 Windows 传入 argv）
#[tauri::command]
fn get_launch_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| MD_EXTS.iter().any(|ext| a.to_lowercase().ends_with(ext)))
}

/// 调用 Windows 自带的 reg.exe 写一条注册表项
fn reg_add(args: &[&str]) -> Result<(), String> {
    let status = Command::new("reg")
        .args(args)
        .output()
        .map_err(|e| format!("调用 reg.exe 失败：{e}"))?;
    if !status.status.success() {
        let stderr = String::from_utf8_lossy(&status.stderr);
        let stdout = String::from_utf8_lossy(&status.stdout);
        return Err(format!("写注册表失败：{} {}", stdout.trim(), stderr.trim()));
    }
    Ok(())
}

/// 把 ExchangeMD 注册进 .md 的「打开方式」列表（HKCU，无需管理员权限）
#[tauri::command]
fn register_md_handler() -> Result<String, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("无法获取程序路径：{e}"))?
        .to_string_lossy()
        .to_string();
    let open_cmd = format!("\"{}\" \"%1\"", exe);
    let icon = format!("\"{}\",0", exe);

    let base = format!("HKCU\\Software\\Classes\\{}", PROG_ID);

    // 1) ProgID 基本信息
    reg_add(&["add", &base, "/ve", "/d", "ExchangeMD Markdown 文档", "/f"])?;
    reg_add(&["add", &format!("{}\\DefaultIcon", base), "/ve", "/d", &icon, "/f"])?;
    reg_add(&[
        "add", &format!("{}\\shell\\open\\command", base), "/ve", "/d", &open_cmd, "/f",
    ])?;

    // 2) 把 ProgID 加进各 Markdown 扩展名的 OpenWithProgids / OpenWithList
    for ext in MD_EXTS {
        let dot = format!("HKCU\\Software\\Classes\\{}", ext);
        reg_add(&["add", &format!("{}\\OpenWithProgids", dot), "/v", PROG_ID, "/t", "REG_SZ", "/d", "", "/f"])?;
        reg_add(&["add", &format!("{}\\OpenWithList", dot), "/v", APP_NAME, "/t", "REG_SZ", "/d", "", "/f"])?;
    }

    Ok(format!("已注册到打开方式列表（程序：{}）", exe))
}

/// 打开系统「默认应用」设置页，让用户一键确认把 .md 默认交给 ExchangeMD
#[tauri::command]
fn open_default_apps_settings() -> Result<(), String> {
    let op = wide("open");
    let file = wide("ms-settings:defaultapps");
    let h = unsafe {
        ShellExecuteW(0, op.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), 1)
    };
    if h as usize <= 32 {
        return Err(format!("无法打开系统设置（错误码 {h}）"));
    }
    Ok(())
}

/// 用系统默认浏览器打开外部链接（ShellExecuteW，无 cmd 黑框、无引号转义问题）
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let op = wide("open");
    let file = wide(&url);
    // 返回值 > 32 表示成功；<= 32 是错误码
    let h = unsafe {
        ShellExecuteW(
            0,
            op.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1, // SW_SHOWNORMAL
        )
    };
    if h as usize <= 32 {
        return Err(format!("无法打开链接（ShellExecute 错误码 {h}）"));
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            read_file_bytes,
            write_text_file,
            write_file_bytes,
            get_launch_file,
            register_md_handler,
            open_default_apps_settings,
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("运行 ExchangeMD 时出错");
}
