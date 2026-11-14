//! Native Windows hit target for the application's rendered maximize button.
//! The system owns the Snap flyout; no keyboard or mouse input is synthesized.
use serde::Deserialize;

#[derive(Clone, Copy, Debug, Deserialize)]
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Region {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
    viewport_height: f64,
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, PartialEq)]
struct Pixels {
    left: i32,
    top: i32,
    width: i32,
    height: i32,
}

#[cfg(any(windows, test))]
impl Region {
    fn pixels(self, width: i32, height: i32, resize_top: i32) -> Option<Pixels> {
        let values = [
            self.left,
            self.top,
            self.width,
            self.height,
            self.viewport_width,
            self.viewport_height,
        ];
        if values.iter().any(|value| !value.is_finite())
            || width <= 0
            || height <= 0
            || !(1.0..=32768.0).contains(&self.viewport_width)
            || !(1.0..=32768.0).contains(&self.viewport_height)
            || self.left < 0.0
            || !(0.0..=8.0).contains(&self.top)
            || !(8.0..=96.0).contains(&self.width)
            || !(12.0..=64.0).contains(&self.height)
            || self.left + self.width > self.viewport_width
            || self.top + self.height > self.viewport_height
            || self.viewport_width - self.left > 288.0
        {
            return None;
        }
        // client / viewport includes display DPI and the current WebView zoom.
        let x = f64::from(width) / self.viewport_width;
        let y = f64::from(height) / self.viewport_height;
        if !(0.1..=16.0).contains(&x)
            || !(0.1..=16.0).contains(&y)
            || (x - y).abs() > x.max(y) * 0.02
        {
            return None;
        }
        // Round inward so the native target never covers a neighbouring control.
        let left = (self.left * x).ceil() as i32;
        let top = ((self.top * y).ceil() as i32).max(resize_top);
        let right = ((self.left + self.width) * x).floor() as i32;
        let bottom = ((self.top + self.height) * y).floor() as i32;
        (right > left && bottom > top).then_some(Pixels {
            left,
            top,
            width: right - left,
            height: bottom - top,
        })
    }
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Default, PartialEq)]
struct Pointer {
    hovered: bool,
    armed: bool,
}
#[cfg(any(windows, test))]
impl Pointer {
    fn press(&mut self) {
        self.hovered = true;
        self.armed = true;
    }
    fn release(&mut self, inside: bool) -> bool {
        let clicked = self.armed && inside;
        self.armed = false;
        self.hovered = inside;
        clicked
    }
}

#[cfg(any(windows, test))]
#[derive(Default)]
struct Lease {
    epoch: u64,
    rect: Option<Pixels>,
    pointer: Pointer,
}
#[cfg(any(windows, test))]
impl Lease {
    fn invalidate(&mut self) {
        self.rect = None;
        self.pointer = Pointer::default();
    }
    fn owns(&self, epoch: u64) -> bool {
        self.epoch == epoch
    }
    fn replace(&mut self, epoch: u64) {
        self.epoch = epoch;
        self.invalidate();
    }
}

#[cfg(windows)]
mod windows;

pub fn install(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    windows::install(window);
    #[cfg(not(windows))]
    let _ = window;
}
pub fn page_started(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    windows::page_started(window);
    #[cfg(not(windows))]
    let _ = window;
}
pub async fn claim(window: tauri::WebviewWindow) -> Result<Option<u64>, String> {
    #[cfg(windows)]
    {
        windows::claim(window).await.map(Some)
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(None)
    }
}
pub async fn update(
    window: tauri::WebviewWindow,
    epoch: u64,
    rect: Option<Region>,
) -> Result<bool, String> {
    #[cfg(windows)]
    {
        windows::update(window, epoch, rect).await
    }
    #[cfg(not(windows))]
    {
        let _ = (window, epoch, rect);
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn region() -> Region {
        Region {
            left: 1192.0,
            top: 0.0,
            width: 44.0,
            height: 36.0,
            viewport_width: 1280.0,
            viewport_height: 850.0,
        }
    }
    #[test]
    fn measured_geometry_uses_client_pixels_and_keeps_top_resize_priority() {
        assert_eq!(
            region().pixels(1280, 850, 8),
            Some(Pixels {
                left: 1192,
                top: 8,
                width: 44,
                height: 28
            })
        );
        assert_eq!(region().pixels(1280, 850, 0).unwrap().top, 0);
        assert_eq!(
            region().pixels(1920, 1275, 12),
            Some(Pixels {
                left: 1788,
                top: 12,
                width: 66,
                height: 42
            })
        );
        assert_eq!(region().pixels(3840, 2550, 0).unwrap().width, 132);
    }
    #[test]
    fn stale_viewport_and_untrusted_rectangles_cannot_cover_page_content() {
        assert!(region().pixels(1500, 850, 8).is_none());
        for changed in [
            Region {
                left: 20.0,
                ..region()
            },
            Region {
                top: 100.0,
                ..region()
            },
            Region {
                width: 800.0,
                ..region()
            },
            Region {
                left: f64::NAN,
                ..region()
            },
            Region {
                viewport_width: 0.0,
                ..region()
            },
            Region {
                height: f64::INFINITY,
                ..region()
            },
        ] {
            assert!(changed.pixels(1280, 850, 8).is_none());
        }
    }
    #[test]
    fn a_pointer_release_activates_exactly_once_and_dragging_out_cancels() {
        let mut pointer = Pointer::default();
        assert!(!pointer.release(true));
        pointer.press();
        assert!(!pointer.release(false));
        pointer.press();
        assert!(pointer.release(true));
        assert!(!pointer.release(true));
    }
    #[test]
    fn old_renderer_cleanup_cannot_own_a_new_registration_and_resize_clears_armed_geometry() {
        let mut lease = Lease {
            epoch: 10,
            rect: region().pixels(1280, 850, 8),
            pointer: Pointer {
                hovered: true,
                armed: true,
            },
        };
        lease.replace(11);
        assert!(!lease.owns(10));
        assert!(lease.owns(11));
        assert!(lease.rect.is_none());
        lease.rect = region().pixels(1280, 850, 8);
        lease.pointer.press();
        lease.invalidate();
        assert!(lease.owns(11));
        assert!(lease.rect.is_none());
        assert!(!lease.pointer.release(true));
    }
}
