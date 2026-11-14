use super::{Lease, Pointer, Region};
use serde::Serialize;
use std::{
    cell::RefCell,
    collections::HashMap,
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{
        OnceLock,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::{Emitter, WebviewWindow};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
    Graphics::Gdi::ScreenToClient,
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Controls::WM_MOUSELEAVE,
        HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi},
        Input::KeyboardAndMouse::{
            GetCapture, ReleaseCapture, SetCapture, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT,
            TrackMouseEvent,
        },
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::*,
    },
};

const SUBCLASS: usize = 0x5250534e;
const CLASS: *const u16 = windows_sys::core::w!("Repeaty.SnapTarget");
static CLASS_MODULE: OnceLock<Result<usize, String>> = OnceLock::new();
static NEXT_EPOCH: AtomicU64 = AtomicU64::new(1);
thread_local! { static FRAMES: RefCell<HashMap<isize, Frame>> = RefCell::new(HashMap::new()); }
struct Frame {
    window: WebviewWindow,
    child: isize,
    lease: Lease,
}
#[derive(Clone, Copy, Serialize)]
struct Visual {
    epoch: u64,
    hovered: bool,
    pressed: bool,
}
#[derive(Clone, Copy, Serialize)]
struct Invalidated {
    epoch: u64,
}
fn next_epoch() -> u64 {
    NEXT_EPOCH.fetch_add(1, Ordering::Relaxed)
}
fn visual(frame: &Frame) -> Visual {
    Visual {
        epoch: frame.lease.epoch,
        hovered: frame.lease.pointer.hovered,
        pressed: frame.lease.pointer.armed && frame.lease.pointer.hovered,
    }
}
fn publish(value: Option<(WebviewWindow, Visual)>) {
    if let Some((window, state)) = value {
        let _ = window.emit("window-snap-state", state);
    }
}
fn child_parent(child: HWND) -> Option<isize> {
    FRAMES.with_borrow(|frames| {
        frames
            .iter()
            .find_map(|(&parent, frame)| (frame.child == child as isize).then_some(parent))
    })
}
fn hide(parent: isize, renew: bool, invalidated: bool) {
    let value = FRAMES.with_borrow_mut(|frames| {
        frames.get_mut(&parent).map(|frame| {
            if renew {
                frame.lease.replace(next_epoch());
            } else {
                frame.lease.invalidate();
            }
            (frame.child, frame.window.clone(), visual(frame))
        })
    });
    if let Some((child, window, state)) = value {
        // SAFETY: all registry accesses and HWND operations run on the window GUI thread.
        if child != 0 {
            unsafe {
                ShowWindow(child as HWND, SW_HIDE);
                if GetCapture() == child as HWND {
                    ReleaseCapture();
                }
            }
        }
        let _ = window.emit("window-snap-state", state);
        if invalidated {
            let _ = window.emit(
                "window-snap-invalidated",
                Invalidated { epoch: state.epoch },
            );
        }
    }
}
fn ensure(window: &WebviewWindow) -> Result<isize, String> {
    let parent = window.hwnd().map_err(|_| "snap-window-unavailable")?.0 as isize;
    if FRAMES.with_borrow(|frames| frames.contains_key(&parent)) {
        return Ok(parent);
    }
    // SAFETY: Tauri supplied this live HWND; callbacks have static system ABI.
    if unsafe { SetWindowSubclass(parent as HWND, Some(parent_proc), SUBCLASS, 0) } == 0 {
        return Err("snap-window-unavailable".into());
    }
    FRAMES.with_borrow_mut(|frames| {
        frames.insert(
            parent,
            Frame {
                window: window.clone(),
                child: 0,
                lease: Lease {
                    epoch: next_epoch(),
                    ..Default::default()
                },
            },
        );
    });
    Ok(parent)
}
pub(super) fn install(window: &WebviewWindow) {
    let native = window.clone();
    let _ = window.run_on_main_thread(move || {
        let _ = ensure(&native);
    });
}
pub(super) fn page_started(window: &WebviewWindow) {
    let native = window.clone();
    let _ = window.run_on_main_thread(move || {
        if let Ok(parent) = ensure(&native) {
            hide(parent, true, false);
        }
    });
}
async fn on_gui<T: Send + 'static>(
    window: WebviewWindow,
    action: impl FnOnce(WebviewWindow) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let native = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = send.send(action(native));
        })
        .map_err(|_| "snap-window-unavailable")?;
    receive.await.map_err(|_| "snap-window-unavailable")?
}
pub(super) async fn claim(window: WebviewWindow) -> Result<u64, String> {
    on_gui(window, |window| {
        let parent = ensure(&window)?;
        hide(parent, true, false);
        Ok(FRAMES.with_borrow(|frames| frames[&parent].lease.epoch))
    })
    .await
}
pub(super) async fn update(
    window: WebviewWindow,
    epoch: u64,
    rect: Option<Region>,
) -> Result<bool, String> {
    on_gui(window, move |window| {
        let parent = ensure(&window)?;
        if !FRAMES.with_borrow(|frames| frames[&parent].lease.owns(epoch)) {
            return Ok(false);
        }
        hide(parent, false, false);
        let Some(rect) = rect else {
            return Ok(false);
        };
        if window
            .is_fullscreen()
            .map_err(|_| "snap-window-unavailable")?
        {
            return Ok(false);
        }
        let mut client = Default::default();
        // SAFETY: parent is a live Tauri HWND, client is an initialized output buffer.
        if unsafe { GetClientRect(parent as HWND, &mut client) } == 0 {
            return Err("snap-window-unavailable".into());
        }
        // Keep the system's top resize strip above the custom hit target.
        let resize_top = if unsafe { IsZoomed(parent as HWND) } != 0 {
            0
        } else {
            let dpi = unsafe { GetDpiForWindow(parent as HWND) };
            unsafe {
                GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi)
                    + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi)
            }
        };
        let Some(pixels) = rect.pixels(client.right, client.bottom, resize_top) else {
            return Ok(false);
        };
        let child = create_child(parent)?;
        FRAMES.with_borrow_mut(|frames| {
            frames
                .get_mut(&parent)
                .expect("registered frame")
                .lease
                .rect = Some(pixels);
        });
        // SAFETY: child belongs to parent and pixels are bounded client coordinates.
        if unsafe {
            SetWindowPos(
                child as HWND,
                HWND_TOP,
                pixels.left,
                pixels.top,
                pixels.width,
                pixels.height,
                SWP_SHOWWINDOW | SWP_NOACTIVATE,
            )
        } == 0
        {
            hide(parent, false, false);
            return Err("snap-window-unavailable".into());
        }
        Ok(true)
    })
    .await
}
fn create_child(parent: isize) -> Result<isize, String> {
    let existing = FRAMES.with_borrow(|frames| frames[&parent].child);
    if existing != 0 {
        return Ok(existing);
    }
    let module = CLASS_MODULE
        .get_or_init(|| {
            // SAFETY: static class name/proc outlive all created windows; null optional resources do not paint.
            let module = unsafe { GetModuleHandleW(std::ptr::null()) };
            if module.is_null() {
                return Err("snap-window-unavailable".into());
            }
            let class = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(child_proc),
                hInstance: module,
                lpszClassName: CLASS,
                ..Default::default()
            };
            if unsafe { RegisterClassExW(&class) } == 0 {
                return Err("snap-window-unavailable".into());
            }
            Ok(module as usize)
        })
        .as_ref()
        .copied()
        .map_err(Clone::clone)?;
    // A normal transparent-background child is intentional: a fully transparent layered window
    // would pass hit testing through to WebView2 and never expose HTMAXBUTTON to Windows.
    // SAFETY: class is registered above and parent is still owned by this GUI thread.
    let child = unsafe {
        CreateWindowExW(
            0,
            CLASS,
            CLASS,
            WS_CHILD | WS_CLIPSIBLINGS,
            0,
            0,
            0,
            0,
            parent as HWND,
            std::ptr::null_mut(),
            module as _,
            std::ptr::null(),
        )
    };
    if child.is_null() {
        return Err("snap-window-unavailable".into());
    }
    FRAMES.with_borrow_mut(|frames| {
        frames.get_mut(&parent).expect("registered frame").child = child as isize;
    });
    Ok(child as isize)
}
unsafe extern "system" fn parent_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _: usize,
    _: usize,
) -> LRESULT {
    catch_unwind(AssertUnwindSafe(|| {
        match message {
            WM_SIZE | WM_DPICHANGED => hide(hwnd as isize, false, true),
            WM_NCDESTROY => {
                // Windows destroys child HWNDs before the parent's terminal message.
                let removed = FRAMES.with_borrow_mut(|frames| frames.remove(&(hwnd as isize)));
                drop(removed);
                // SAFETY: this exact subclass callback is currently installed on hwnd.
                unsafe {
                    RemoveWindowSubclass(hwnd, Some(parent_proc), SUBCLASS);
                }
            }
            _ => {}
        }
        // SAFETY: original parameters continue down the existing Tauri subclass chain.
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }))
    .unwrap_or_else(|_| unsafe { DefSubclassProc(hwnd, message, wparam, lparam) })
}
fn pointer_inside(hwnd: HWND) -> bool {
    let mut point = POINT::default();
    let mut bounds = Default::default();
    // Signed screen coordinates are preserved, including monitors left/above the primary display.
    // SAFETY: valid stack buffers and the live child HWND supplied to its window procedure.
    unsafe {
        GetCursorPos(&mut point) != 0
            && ScreenToClient(hwnd, &mut point) != 0
            && GetClientRect(hwnd, &mut bounds) != 0
            && point.x >= 0
            && point.y >= 0
            && point.x < bounds.right
            && point.y < bounds.bottom
    }
}
fn change_pointer(parent: isize, change: impl FnOnce(&mut Pointer)) {
    publish(FRAMES.with_borrow_mut(|frames| {
        frames.get_mut(&parent).and_then(|frame| {
            let previous = frame.lease.pointer;
            change(&mut frame.lease.pointer);
            (previous != frame.lease.pointer).then(|| (frame.window.clone(), visual(frame)))
        })
    }));
}
unsafe fn handle_child(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let Some(parent) = child_parent(hwnd) else {
        return unsafe { DefWindowProcW(hwnd, message, wparam, lparam) };
    };
    let active = FRAMES.with_borrow(|frames| frames[&parent].lease.rect.is_some());
    // A queued mouse message from a hidden/previous renderer cannot arm or activate
    // a target that was invalidated by navigation, resize, or lease replacement.
    if !active
        && matches!(
            message,
            WM_NCMOUSEMOVE
                | WM_MOUSEMOVE
                | WM_NCLBUTTONDOWN
                | WM_LBUTTONDOWN
                | WM_NCLBUTTONDBLCLK
                | WM_LBUTTONDBLCLK
                | WM_NCLBUTTONUP
                | WM_LBUTTONUP
                | WM_NCMOUSELEAVE
                | WM_MOUSELEAVE
                | WM_CAPTURECHANGED
                | WM_CANCELMODE
        )
    {
        return 0;
    }
    match message {
        WM_NCHITTEST => {
            return if active {
                HTMAXBUTTON as LRESULT
            } else {
                HTTRANSPARENT as LRESULT
            };
        }
        WM_ERASEBKGND => return 1,
        WM_NCMOUSEMOVE | WM_MOUSEMOVE => {
            let inside = pointer_inside(hwnd);
            change_pointer(parent, |pointer| pointer.hovered = inside);
            let mut track = TRACKMOUSEEVENT {
                cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                dwFlags: TME_LEAVE
                    | if message == WM_NCMOUSEMOVE {
                        TME_NONCLIENT
                    } else {
                        0
                    },
                hwndTrack: hwnd,
                dwHoverTime: 0,
            };
            // SAFETY: track is initialized for this live child.
            unsafe {
                TrackMouseEvent(&mut track);
            }
        }
        WM_NCLBUTTONDOWN | WM_LBUTTONDOWN | WM_NCLBUTTONDBLCLK | WM_LBUTTONDBLCLK => {
            change_pointer(parent, Pointer::press);
            // SAFETY: capture preserves the release/drag-out path even outside this narrow target.
            unsafe {
                SetForegroundWindow(parent as HWND);
                SetCapture(hwnd);
            }
            return 0;
        }
        WM_NCLBUTTONUP | WM_LBUTTONUP => {
            let inside = pointer_inside(hwnd);
            let mut clicked = false;
            change_pointer(parent, |pointer| clicked = pointer.release(inside));
            // Release after disarming; the resulting WM_CAPTURECHANGED cannot activate twice.
            unsafe {
                if GetCapture() == hwnd {
                    ReleaseCapture();
                }
            }
            if clicked {
                let action = if unsafe { IsZoomed(parent as HWND) } != 0 {
                    SC_RESTORE
                } else {
                    SC_MAXIMIZE
                };
                // SAFETY: posting delegates one real maximize/restore operation to the parent OS window.
                unsafe {
                    PostMessageW(parent as HWND, WM_SYSCOMMAND, action as usize, 0);
                }
            }
            return 0;
        }
        WM_NCMOUSELEAVE | WM_MOUSELEAVE => {
            change_pointer(parent, |pointer| pointer.hovered = false)
        }
        WM_CAPTURECHANGED => change_pointer(parent, |pointer| {
            if pointer.armed {
                *pointer = Pointer::default();
            }
        }),
        WM_CANCELMODE => change_pointer(parent, |pointer| *pointer = Pointer::default()),
        WM_NCDESTROY => {
            FRAMES.with_borrow_mut(|frames| {
                if let Some(frame) = frames.get_mut(&parent) {
                    frame.child = 0;
                    frame.lease.invalidate();
                }
            });
        }
        _ => {}
    }
    // Keep the system's non-client hover processing, including the Windows 11 Snap timer.
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}
unsafe extern "system" fn child_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    catch_unwind(AssertUnwindSafe(|| unsafe {
        handle_child(hwnd, message, wparam, lparam)
    }))
    .unwrap_or_else(|_| unsafe { DefWindowProcW(hwnd, message, wparam, lparam) })
}
