//! AXSelectedText reads directly; no pasteboard mutation or synthetic Cmd+C.
use super::Result;
use std::{
    ffi::{c_char, c_void},
    ptr,
};
type CFTypeRef = *const c_void;
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXUIElementCreateSystemWide() -> CFTypeRef;
    fn AXUIElementSetMessagingTimeout(element: CFTypeRef, timeout: f32) -> i32;
    fn AXUIElementCopyAttributeValue(
        element: CFTypeRef,
        attribute: CFTypeRef,
        value: *mut CFTypeRef,
    ) -> i32;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(value: CFTypeRef);
    fn CFStringCreateWithCString(
        allocator: CFTypeRef,
        text: *const c_char,
        encoding: u32,
    ) -> CFTypeRef;
    fn CFGetTypeID(value: CFTypeRef) -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFStringGetLength(value: CFTypeRef) -> isize;
    fn CFStringGetMaximumSizeForEncoding(length: isize, encoding: u32) -> isize;
    fn CFStringGetCString(
        value: CFTypeRef,
        buffer: *mut c_char,
        size: isize,
        encoding: u32,
    ) -> bool;
}
struct Owned(CFTypeRef);
impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                CFRelease(self.0);
            }
        }
    }
}
pub fn permission() -> &'static str {
    if unsafe { AXIsProcessTrusted() } {
        "granted"
    } else {
        "accessibility-required"
    }
}
unsafe fn attribute(element: CFTypeRef, name: &std::ffi::CStr) -> Result<Owned> {
    let name = Owned(unsafe { CFStringCreateWithCString(ptr::null(), name.as_ptr(), 0x08000100) });
    let mut value = ptr::null();
    if name.0.is_null()
        || unsafe { AXUIElementCopyAttributeValue(element, name.0, &mut value) } != 0
        || value.is_null()
    {
        return Err("selection-unavailable".into());
    }
    Ok(Owned(value))
}
pub fn selection(limit: usize) -> Result<String> {
    if permission() != "granted" {
        return Err("accessibility-required".into());
    }
    unsafe {
        let system = Owned(AXUIElementCreateSystemWide());
        if system.0.is_null() {
            return Err("selection-unavailable".into());
        }
        let _ = AXUIElementSetMessagingTimeout(system.0, 0.8);
        let focused = attribute(system.0, c"AXFocusedUIElement")?;
        let value = attribute(focused.0, c"AXSelectedText")?;
        if CFGetTypeID(value.0) != CFStringGetTypeID() {
            return Err("selection-unavailable".into());
        }
        let length = CFStringGetLength(value.0);
        if length < 0 || length as usize > limit {
            return Err("capture-size-limit".into());
        }
        let capacity = CFStringGetMaximumSizeForEncoding(length, 0x08000100) + 1;
        if capacity < 1 || capacity as usize > limit * 4 + 1 {
            return Err("capture-size-limit".into());
        }
        let mut bytes = vec![0u8; capacity as usize];
        if !CFStringGetCString(value.0, bytes.as_mut_ptr().cast(), capacity, 0x08000100) {
            return Err("selection-unavailable".into());
        }
        let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
        String::from_utf8(bytes[..end].to_vec()).map_err(|_| "selection-unavailable".into())
    }
}
