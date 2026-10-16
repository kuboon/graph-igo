//! The calling convention both wasm modules export.
//!
//! Every call takes one JSON document and returns one. The host copies the request into the
//! module's memory with `alloc`, calls the function with the pointer and the length, and gets back
//! the length of the response, which it reads from `result_ptr()`. A failure comes back as
//! `{"error": "..."}` rather than as a trap, so a bad request never kills the instance.
//!
//! [`export_abi!`] emits `alloc`, `dealloc` and `result_ptr`; [`export_json!`] wraps one handler.

use std::cell::RefCell;

use serde::{de::DeserializeOwned, Serialize};

thread_local! {
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

pub fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len.max(1));
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// # Safety
/// `ptr` and `len` must be exactly what one earlier [`alloc`] call handed out.
pub unsafe fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

pub fn result_ptr() -> *const u8 {
    RESULT.with(|r| r.borrow().as_ptr())
}

fn store(bytes: Vec<u8>) -> usize {
    let len = bytes.len();
    RESULT.with(|r| *r.borrow_mut() = bytes);
    len
}

/// Parses the request, runs `handler`, and stores its answer (or the error) as the result.
///
/// # Safety
/// `ptr..ptr + len` must be readable memory holding the request.
pub unsafe fn call<Req, Res>(
    ptr: *const u8,
    len: usize,
    handler: impl FnOnce(Req) -> Result<Res, String>,
) -> usize
where
    Req: DeserializeOwned,
    Res: Serialize,
{
    let input = std::slice::from_raw_parts(ptr, len);
    let result = serde_json::from_slice::<Req>(input)
        .map_err(|e| format!("bad request: {e}"))
        .and_then(handler);
    let bytes = match result {
        Ok(value) => serde_json::to_vec(&value),
        Err(error) => serde_json::to_vec(&serde_json::json!({ "error": error })),
    };
    store(bytes.unwrap_or_else(|_| br#"{"error":"could not encode the response"}"#.to_vec()))
}

#[macro_export]
macro_rules! export_abi {
    () => {
        #[no_mangle]
        pub extern "C" fn alloc(len: usize) -> *mut u8 {
            $crate::abi::alloc(len)
        }

        /// # Safety
        /// See [`graph_go_core::abi::dealloc`].
        #[no_mangle]
        pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
            $crate::abi::dealloc(ptr, len)
        }

        #[no_mangle]
        pub extern "C" fn result_ptr() -> *const u8 {
            $crate::abi::result_ptr()
        }
    };
}

#[macro_export]
macro_rules! export_json {
    ($name:ident, $handler:path) => {
        /// # Safety
        /// See [`graph_go_core::abi::call`].
        #[no_mangle]
        pub unsafe extern "C" fn $name(ptr: *const u8, len: usize) -> usize {
            $crate::abi::call(ptr, len, $handler)
        }
    };
}
