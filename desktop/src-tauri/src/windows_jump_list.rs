use std::{mem::ManuallyDrop, path::Path};

use windows::{
    core::{Interface, GUID, PCWSTR},
    Win32::{
        Foundation::PROPERTYKEY,
        System::Com::{
            CoCreateInstance, CoInitializeEx,
            StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0},
            CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
        },
        System::Variant::VT_LPWSTR,
        UI::Shell::{
            Common::{IObjectArray, IObjectCollection},
            DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW,
            PropertiesSystem::IPropertyStore,
            SHStrDupW, ShellLink,
        },
    },
};

const STAGEPILOT_APP_ID: &str = "org.stagepilot.desktop";
const PKEY_TITLE: PROPERTYKEY = PROPERTYKEY {
    fmtid: GUID::from_u128(0xf29f85e04ff91068ab9108002b27b3d9),
    pid: 2,
};

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe fn task_link(
    executable: &Path,
    argument: &str,
    title: &str,
) -> windows::core::Result<IShellLinkW> {
    let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
    let executable = wide(&executable.to_string_lossy());
    let argument = wide(argument);
    let title = wide(title);
    link.SetPath(PCWSTR(executable.as_ptr()))?;
    link.SetArguments(PCWSTR(argument.as_ptr()))?;
    link.SetDescription(PCWSTR(title.as_ptr()))?;
    link.SetIconLocation(PCWSTR(executable.as_ptr()), 0)?;
    let property_store: IPropertyStore = link.cast()?;
    // PROPVARIANT::drop calls PropVariantClear, so an LPWSTR stored inside it must
    // be allocated with the COM allocator. Pointing it at a Rust Vec causes Windows
    // to free foreign memory and terminates StagePilot with heap corruption.
    let owned_title = SHStrDupW(PCWSTR(title.as_ptr()))?;
    let title_value = PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_LPWSTR,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 {
                    pwszVal: owned_title,
                },
            }),
        },
    };
    property_store.SetValue(&PKEY_TITLE, &title_value)?;
    property_store.Commit()?;
    Ok(link)
}

pub fn install() -> Result<(), String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Could not locate the StagePilot executable: {error}"))?;
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let destination_list: ICustomDestinationList =
            CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| error.to_string())?;
        let app_id = wide(STAGEPILOT_APP_ID);
        destination_list
            .SetAppID(PCWSTR(app_id.as_ptr()))
            .map_err(|error| error.to_string())?;
        let mut slots = 0;
        let _: IObjectArray = destination_list
            .BeginList(&mut slots)
            .map_err(|error| error.to_string())?;

        let collection: IObjectCollection =
            CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| error.to_string())?;
        let restart = task_link(&executable, "--stagepilot-restart", "Restart StagePilot")
            .map_err(|error| error.to_string())?;
        let quit = task_link(&executable, "--stagepilot-quit", "Quit StagePilot")
            .map_err(|error| error.to_string())?;
        collection
            .AddObject(&restart)
            .map_err(|error| error.to_string())?;
        collection
            .AddObject(&quit)
            .map_err(|error| error.to_string())?;
        let tasks: IObjectArray = collection.cast().map_err(|error| error.to_string())?;
        destination_list
            .AddUserTasks(&tasks)
            .map_err(|error| error.to_string())?;
        destination_list
            .CommitList()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}
