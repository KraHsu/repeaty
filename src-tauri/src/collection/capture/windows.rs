//! Read the current accessibility selection without writing to the clipboard or synthesizing keys.
use super::Result;
use windows::{
    Win32::{
        System::Com::{
            CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
            CoUninitialize,
        },
        UI::Accessibility::{
            CUIAutomation8, IUIAutomation, IUIAutomation2, IUIAutomationTextPattern,
            UIA_TextPatternId,
        },
    },
    core::Interface,
};
pub fn selection(limit: usize) -> Result<String> {
    // Each capture runs on a blocking thread. COM references stay on this thread.
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(|_| "selection-unavailable")?;
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe {
                    CoUninitialize();
                }
            }
        }
        let _apartment = Apartment;
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER)
                .map_err(|_| "selection-unavailable")?;
        if let Ok(options) = automation.cast::<IUIAutomation2>() {
            let _ = options.SetConnectionTimeout(800);
            let _ = options.SetTransactionTimeout(800);
        }
        let element = automation
            .GetFocusedElement()
            .map_err(|_| "selection-unavailable")?;
        // Password inputs must never be collected.
        if element
            .CurrentIsPassword()
            .map_err(|_| "selection-unavailable")?
            .as_bool()
        {
            return Err("selection-protected".into());
        }
        let pattern: IUIAutomationTextPattern = element
            .GetCurrentPatternAs(UIA_TextPatternId)
            .map_err(|_| "selection-unavailable")?;
        let ranges = pattern
            .GetSelection()
            .map_err(|_| "selection-unavailable")?;
        let count = ranges.Length().map_err(|_| "selection-unavailable")?;
        if count > 100 {
            return Err("capture-size-limit".into());
        }
        let mut text = String::new();
        for index in 0..count {
            let part = ranges
                .GetElement(index)
                .and_then(|range| range.GetText(limit as i32 + 1))
                .map_err(|_| "selection-unavailable")?
                .to_string();
            if !text.is_empty() && !part.is_empty() {
                text.push('\n');
            }
            text.push_str(&part);
            if text.len() > limit {
                return Err("capture-size-limit".into());
            }
        }
        Ok(text)
    }
}
