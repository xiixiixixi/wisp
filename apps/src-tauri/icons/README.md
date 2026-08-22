# Tauri Icons

`icon-source.png` is the 1024×1024 master artwork for the Wisp brand icon. The visible
rounded-square artwork occupies 84% of the canvas, leaving an 8% transparent safe area
on each side so the macOS Dock matches the optical size of native app icons.
Generate the desktop bundle assets from that source with:

```sh
pnpm tauri icon apps/src-tauri/icons/icon-source.png -o apps/src-tauri/icons
```

This directory contains the application icons in the following formats:

- 32x32.png
- 64x64.png
- 128x128.png
- 128x128@2x.png
- icon.png
- icon.icns (for macOS)
- icon.ico (for Windows)

You can generate these icons from a single high-resolution source image using tools like:
- `tauri icon` command
- Online icon generators
- Image editing software

The website uses the same generated artwork through `apps/web/public/logo.png`
and `apps/web/public/favicon.ico`.
