# Moxxy voice avatar frames

The five PNG frames were supplied by the project owner in `Electron-Handoff.rar`
for use as the desktop Voice Mode character. Keep their dimensions, alpha channel,
alignment, and filenames unchanged. The adjacent asset-contract test pins the
original SHA-256 checksums so accidental recompression cannot desynchronise the
animation.

Source archive SHA-256:
`48ba1e5ae4d88c3dd90f970b1696033bdd70198a629b62f0c7439222dfd8f2c4`

The `focus/` directory contains 320×400 alpha-preserving derivatives of the
same aligned frames. The always-on-top Focus renderer uses those smaller files
so its tiny pet does not decode five 1122×1402 canvases for the whole session.
