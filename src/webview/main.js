(() => {
  const vscode = acquireVsCodeApi();

  const fileListElement = document.getElementById('file-list');
  const searchBox = document.getElementById('search-box');
  const copyButton = document.getElementById('copy-button');
  const promptInput = document.getElementById('prompt-input');
  let allFilesData = [];

  window.addEventListener('message', (event) => {
    const message = event.data;

    switch (message.command) {
      case 'loadFiles':
        allFilesData = message.files || [];
        renderFileList(allFilesData);
        break;
      case 'showError':
        if (fileListElement) {
            fileListElement.innerHTML = `<li>Error: ${message.text}</li>`;
        } else {
            console.error("fileListElement not found for error message");
        }
        break;
    }
  });

  function renderFileList(files) {
    if (!fileListElement) { return; }
    if (files.length === 0 && allFilesData.length > 0) {
      fileListElement.innerHTML = '<li>No files match your search.</li>';
      return;
    }
    if (files.length === 0) {
      fileListElement.innerHTML =
        '<li>No suitable files found in workspace (check exclusion settings).</li>';
      return;
    }

    fileListElement.innerHTML = '';
    files.forEach((filePath) => {
      const listItem = document.createElement('li');
      const escapedFilePath = filePath.replace(/</g, "<").replace(/>/g, ">");
      listItem.innerHTML = `
         <label class="file-item-label">
             <input type="checkbox" value="${escapedFilePath}" data-filepath="${filePath}">
             <span>${escapedFilePath}</span>
         </label>
      `;
      listItem.querySelector('.file-item-label').addEventListener('click', (e) => {
           if (e.target.tagName === 'INPUT') {
               return;
           }
           const checkbox = listItem.querySelector('input[type="checkbox"]');
           if (checkbox) {
               checkbox.checked = !checkbox.checked;
           }
      });
      fileListElement.appendChild(listItem);
    });
  }

  if (searchBox) {
      searchBox.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filteredFiles = allFilesData.filter((filePath) =>
          filePath.toLowerCase().includes(searchTerm)
        );
        renderFileList(filteredFiles);
      });
  } else {
      console.error("Search box element not found.");
  }


  if (copyButton) {
      copyButton.addEventListener('click', () => {
        const selectedCheckboxes = fileListElement.querySelectorAll(
          'input[type="checkbox"]:checked'
        );
        const selectedFiles = Array.from(selectedCheckboxes).map(
          (checkbox) => checkbox.dataset.filepath || checkbox.value
        );
        const promptText = promptInput ? promptInput.value : '';

        if (selectedFiles.length === 0) {
          vscode.postMessage({
            command: 'showWarning',
            text: 'No files selected.',
          });
          return;
        }

        vscode.postMessage({
          command: 'copyContent',
          files: selectedFiles,
          prompt: promptText,
        });
      });
  } else {
      console.error("Copy button element not found.");
  }

  vscode.postMessage({ command: 'requestFiles' });

})();