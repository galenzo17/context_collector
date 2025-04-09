// Asegúrate de que este script se ejecute después de que el DOM esté listo
(() => {
  // Obtenemos una referencia a la API de VS Code exclusiva del webview
  const vscode = acquireVsCodeApi();

  const fileListElement = document.getElementById('file-list');
  const searchBox = document.getElementById('search-box');
  const copyButton = document.getElementById('copy-button');
  let allFilesData = []; // Guardamos los datos originales para filtrar

  // --- MANEJO DE MENSAJES DESDE LA EXTENSIÓN ---
  window.addEventListener('message', (event) => {
    const message = event.data; // El objeto JSON enviado desde la extensión

    switch (message.command) {
      case 'loadFiles':
        allFilesData = message.files || [];
        renderFileList(allFilesData);
        break;
      case 'showError':
        fileListElement.innerHTML = `<li>Error: ${message.text}</li>`;
        break;
    }
  });

  // --- RENDERIZADO DE LA LISTA ---
  function renderFileList(files) {
    if (!fileListElement) {return;}
    if (files.length === 0 && allFilesData.length > 0) {
      fileListElement.innerHTML = '<li>No files match your search.</li>';
      return;
    }
    if (files.length === 0) {
      fileListElement.innerHTML =
        '<li>No files found in workspace (excluding node_modules, .git, prompt.txt).</li>';
      return;
    }

    fileListElement.innerHTML = ''; // Limpiar lista anterior
    files.forEach((filePath) => {
      const listItem = document.createElement('li');
      listItem.innerHTML = `
                 <input type="checkbox" value="${filePath}">
                 <span>${filePath}</span>
             `;
      // Hacer que hacer clic en el texto también marque/desmarque el checkbox
      listItem.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT') {
          const checkbox = listItem.querySelector('input[type="checkbox"]');
          if (checkbox) {
            checkbox.checked = !checkbox.checked;
          }
        }
      });
      fileListElement.appendChild(listItem);
    });
  }

  // --- FUNCIONALIDAD DE BÚSQUEDA ---
  searchBox.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const filteredFiles = allFilesData.filter((filePath) =>
      filePath.toLowerCase().includes(searchTerm)
    );
    renderFileList(filteredFiles); // Re-renderizar con los archivos filtrados
  });

  // --- MANEJO DEL BOTÓN DE COPIAR ---
  copyButton.addEventListener('click', () => {
    const selectedCheckboxes = fileListElement.querySelectorAll(
      'input[type="checkbox"]:checked'
    );
    const selectedFiles = Array.from(selectedCheckboxes).map(
      (checkbox) => checkbox.value
    );

    if (selectedFiles.length === 0) {
      // Opcional: Mostrar un mensaje en el webview o dejar que la extensión lo maneje
      vscode.postMessage({
        command: 'showWarning', // Comando personalizado si quieres mostrar en VS Code
        text: 'No files selected.',
      });
      return;
    }

    // Enviar la lista de archivos seleccionados a la extensión (backend)
    vscode.postMessage({
      command: 'copyContent',
      files: selectedFiles,
    });
  });

  // Solicitar archivos cuando el webview esté listo (opcional, si la carga inicial falla)
  // vscode.postMessage({ command: 'requestFiles' });
})();
