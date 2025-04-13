# Prompt File Builder

Quickly select files from your workspace, add a custom guiding prompt, and generate a single `prompt.txt` file containing the content of all selected files. Ideal for preparing context for Large Language Models (LLMs) or other analysis tools.

## Features

*   **File Selection:** Browse and select files directly from the VS Code sidebar view.
*   **File Search:** Filter the file list with a simple search box.
*   **Custom Prompt:** Add your own instructions or context at the beginning of the generated file.
*   **Generate `prompt.txt`:** Combines the custom prompt and the content of selected files into `prompt.txt` in your workspace root.
*   **Progress Indicator:** Shows progress while reading files and generating the output.
*   **Exclusions:** Automatically ignores common folders like `node_modules`, `.git`, build directories, and the `prompt.txt` file itself.

## How to Use

1.  Open the "Prompt Builder" view from the Activity Bar (look for the list icon, or the title you set in `package.json`).
2.  Optionally, type your custom instructions in the "Enter your custom prompt" text area.
3.  Use the search box to filter files if needed.
4.  Check the boxes next to the files you want to include.
5.  Click the "Generate prompt.txt" button.
6.  A `prompt.txt` file will be created or overwritten in the root of your workspace.

## Requirements

*   Visual Studio Code version 1.80.0 or higher.

## Known Issues

*   Currently processes files sequentially. Very large numbers of files or extremely large individual files might take some time.
*   Error handling for file reading is basic; check the `prompt.txt` for any `--- ERROR READING FILE ---` messages.

## Release Notes

See the [CHANGELOG.md](CHANGELOG.md) file.

---

**Enjoy!**