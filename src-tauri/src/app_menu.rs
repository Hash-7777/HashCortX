// ==============================================================
// The menu bar on macOS
//
// Tauri gives a macOS app a default menu, and with it the system's Services
// list: entries other installed apps register, which have nothing to do with
// this one and act on whatever text is selected in it. Its About panel also
// printed the version twice, once as the version and again in brackets as the
// build. This is the same menu without Services, and an About that says the
// version once and when the project began.
//
// Everything else is kept as the default has it, because the Edit menu is
// what makes copy, paste, undo and select all reach the page on macOS.
// Other platforms get no default menu from Tauri and are left without one.
// ==============================================================

use tauri::{Builder, Runtime};

/// The day the project began, as the About panel says it.
#[cfg(target_os = "macos")]
const BEGAN: &str = "Since 1 May 2026";

/// The builder, with this menu on macOS and nothing changed elsewhere.
pub fn on<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    #[cfg(target_os = "macos")]
    {
        builder.menu(build)
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder
    }
}

#[cfg(target_os = "macos")]
fn build<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{AboutMetadata, Menu, PredefinedMenuItem, Submenu};

    let pkg = app.package_info();
    let about = AboutMetadata {
        name: Some(pkg.name.clone()),
        // macOS writes the build in brackets after the version; empty, it writes the version alone.
        short_version: Some(pkg.version.to_string()),
        version: Some(String::new()),
        copyright: Some(BEGAN.into()),
        ..Default::default()
    };

    let app_menu = Submenu::with_items(
        app,
        pkg.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[&PredefinedMenuItem::close_window(app, None)?],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window])
}
