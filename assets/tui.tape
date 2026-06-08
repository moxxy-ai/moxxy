# VHS tape for the moxxy TUI demo GIF.
#   brew install vhs   &&   vhs assets/tui.tape
# Produces assets/tui-demo.gif. Tweak the prompt/timings to taste.
# Docs: https://github.com/charmbracelet/vhs

Output assets/tui-demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 675
Set Theme "Dracula"
Set Padding 24

# Assumes `moxxy` is on PATH and a provider is already configured (`moxxy init`).
Type "moxxy"
Enter
Sleep 4s

Type "list the TypeScript files in this folder and summarize what they do"
Sleep 1s
Enter

# Give the turn time to stream + run a tool or two.
Sleep 12s
