let canvasDataUrl = ''; // 儲存畫布數據 URL
    let imageFiles = []; // 儲存選取的檔案
    let imagePositions = []; // 儲存圖片在畫布上的位置
    let images = []; // 儲存載入的圖片物件
    let draggedIndex = -1; // 追蹤拖動的圖片索引
    let isDragging = false; // 追蹤是否正在拖動
    
    // Table mode variables
    let tableMode = 'table'; // 'imagesPerRow' or 'table'
    let tableOperationMode = 'move'; // 'move' or 'resize' - controls how to interact with images in cells
    let tableRows = 2;
    let tableCols = 2;
    let tableGrid = []; // 2D array to store cell images
    let uploadedTableImages = []; // Images uploaded for table mode
    let uploadedTableFiles = []; // Files uploaded for table mode
    let draggedUploadIndex = -1; // Index of image being dragged from upload area
    let draggedCellIndex = -1; // For dragging between table cells
    let cellSizes = []; // Track cell sizes for dynamic sizing
    let currentResizingCell = null; // Track which cell is currently being resized
    let resizeStartX = 0;
    let resizeStartY = 0;
    let resizeStartWidth = 0;
    let resizeStartHeight = 0;
    let isResizing = false;
    
    // Mode toggle event listener
    document.querySelectorAll('input[name="mode"]').forEach(radio => {
      radio.addEventListener('change', function() {
        tableMode = this.value;
        const originalSettings = document.getElementById('originalModeSettings');
        const tableSettings = document.getElementById('tableModeSettings');
        
        // Clear results and uploaded images when switching modes
        clearAllResultsAndImages();
        
        if (tableMode === 'table') {
          originalSettings.classList.add('hidden');
          tableSettings.classList.add('show');
        } else {
          originalSettings.classList.remove('hidden');
          tableSettings.classList.remove('show');
        }
      }); // Ensure this closing brace matches an opening brace earlier in the code
    });
    
    // Clear all results (both modes)
    function clearAllResults() {
        // Clear only the merged table images
        const tableCells = document.querySelectorAll('.merged-table-cell');
        tableCells.forEach(cell => {
            cell.innerHTML = ''; // Remove any content inside the table cells
        });
      
        // Optionally, reset any related state variables for the merged table
        if (typeof tableGrid !== 'undefined') {
            tableGrid.forEach(row => row.fill(null)); // Clear the table grid data
        }
      
        // Re-render the table grid if necessary
        if (typeof renderTableGrid === 'function') {
            renderTableGrid();
        }
    }
    
    // Clear all results AND uploaded images (both modes)
    function clearAllResultsAndImages() {
      clearAllResults();
      //clearAllUploadedImages();
    }
    
    // Helper function to check if a clipboard item is an image
    function isClipboardItemImage(item) {
      if (!item) return false;
      // Check multiple possible properties for the type
      const itemType = item.type || item.mimeType || '';
      return itemType.startsWith('image/');
    }

    // Helper function to convert HEIC files to supported format
    async function convertHEICToBlob(heicFile) {
      try {
        if (typeof heic2any === 'function') {
          const blob = await heic2any({
            blob: heicFile,
            toType: 'image/jpeg'
          });
          return blob;
        }
        return null;
      } catch (err) {
        console.error('Error converting HEIC:', err);
        return null;
      }
    }

    // Helper function to convert ClipboardItem to File (only for images)
    async function clipboardItemToFile(clipboardItem) {
      try {
        // Check if it's an image type - be more lenient
        const itemType = clipboardItem.type || clipboardItem.mimeType || '';
        if (!itemType || !itemType.startsWith('image/')) {
          throw new Error('No image type found in clipboard item');
        }
        
        // Try to get the blob from the clipboard item using different methods
        let blob;
        
        // Method 1: Try the standard getType method
        if (typeof clipboardItem.getType === 'function') {
          blob = await clipboardItem.getType(itemType);
        } 
        // Method 2: Try to get as blob directly (some browsers support this)
        else if (typeof clipboardItem.getAsFile === 'function') {
          blob = clipboardItem.getAsFile();
        }
        // Method 3: Try to get as data URL and convert to blob
        else if (typeof clipboardItem.getData === 'function') {
          const dataUrl = clipboardItem.getData(itemType);
          if (dataUrl) {
            const response = await fetch(dataUrl);
            blob = await response.blob();
          }
        }
        
        if (!blob) {
          throw new Error('Could not get blob from clipboard item');
        }
        
        const mimeType = blob.type || itemType || 'application/octet-stream';
        
        // Generate a filename based on the MIME type
        let extension = 'png';
        if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
          extension = 'jpg';
        } else if (mimeType === 'image/gif') {
          extension = 'gif';
        } else if (mimeType === 'image/webp') {
          extension = 'webp';
        } else if (mimeType === 'image/bmp') {
          extension = 'bmp';
        }
        
        const timestamp = Date.now();
        return new File([blob], `pasted-image-${timestamp}.${extension}`, { type: mimeType });
      } catch (err) {
        console.error('Error converting clipboard item to file:', err);
        throw err;
      }
    }
    
    // Handle paste event for the paste input field
    const pasteInput = document.getElementById('pasteInput');
    
    // Prevent text input but allow paste
    pasteInput.addEventListener('keydown', (e) => {
      // Allow Ctrl+V and Cmd+V for paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        return;
      }
      // Allow Backspace and Delete to clear the field
      if (e.key === 'Backspace' || e.key === 'Delete') {
        return;
      }
      // Prevent all other keys
      e.preventDefault();
    });
    
    pasteInput.addEventListener('keypress', (e) => {
      e.preventDefault();
    });
    
    pasteInput.addEventListener('keyup', (e) => {
      // Prevent pasting text by clearing any non-image content
      if (pasteInput.value && !e.ctrlKey && !e.metaKey) {
        pasteInput.value = '';
      }
    });
    
    // Handle paste event
    pasteInput.addEventListener('paste', async (event) => {
      event.preventDefault();
      
      const translation = translations[currentLanguage];
      const clipboardData = event.clipboardData || window.clipboardData;
      
      if (!clipboardData) {
        alert('無法訪問剪貼板。請使用瀏覽器支援剪貼板的功能。');
        return;
      }
      
      const items = clipboardData.items;
      
      let pastedCount = 0;
      const pastedFiles = [];
      
      console.log('Paste event triggered. Items:', items);
      console.log('Number of items:', items.length);
      
      // Process each clipboard item
      for (const item of items) {
        console.log('Processing item, type:', item.type, 'mimeType:', item.mimeType);
        try {
          // Check if this item is an image - be more lenient with the check
          const itemType = item.type || item.mimeType || '';
          console.log('Item type check:', itemType, 'starts with image/:', itemType.startsWith('image/'));
          
          if (itemType && itemType.startsWith('image/')) {
            const file = await clipboardItemToFile(item);
            pastedFiles.push(file);
            pastedCount++;
            console.log('Successfully processed image file:', file.name);
          }
        } catch (err) {
          console.error('Error processing pasted item:', err);
        }
      }
      
      if (pastedCount === 0) {
        // Show error message in pasteStatus
        const pasteStatus = document.getElementById('pasteStatus');
        pasteStatus.style.display = 'block';
        pasteStatus.style.background = '#f8d7da';
        pasteStatus.style.borderColor = '#f5c6cb';
        pasteStatus.style.color = '#721c24';
        pasteStatus.textContent = '剪貼板中沒有圖片內容。';
        setTimeout(() => { pasteStatus.style.display = 'none'; }, 3000);
        return;
      }
      
      try {
        // Add pasted files to uploaded files
        uploadedTableFiles = [...uploadedTableFiles, ...pastedFiles].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        
        // Load all images (existing + new)
        uploadedTableImages = await Promise.all(uploadedTableFiles.map(file => loadImage(file)));
        
        // Display thumbnails
        displayUploadedImages();
        
        // Show success message in pasteStatus
        const pasteStatus = document.getElementById('pasteStatus');
        const successMessage = translation.pasteSuccess.replace('{count}', pastedCount.toString());
        pasteStatus.style.display = 'block';
        pasteStatus.style.background = '#d4edda';
        pasteStatus.style.borderColor = '#c3e6cb';
        pasteStatus.style.color = '#155724';
        pasteStatus.textContent = successMessage;
        setTimeout(() => { pasteStatus.style.display = 'none'; }, 3000);
        
        // Note: Don't clear the textarea value so users can keep their text
      } catch (err) {
        console.error('Error loading pasted images:', err);
        const pasteStatus = document.getElementById('pasteStatus');
        pasteStatus.style.display = 'block';
        pasteStatus.style.background = '#f8d7da';
        pasteStatus.style.borderColor = '#f5c6cb';
        pasteStatus.style.color = '#721c24';
        pasteStatus.textContent = translation.pasteError;
        setTimeout(() => { pasteStatus.style.display = 'none'; }, 3000);
      }
    });
    
    // Initialize UI based on default mode (table mode)
    (function() {
      const originalSettings = document.getElementById('originalModeSettings');
      const tableSettings = document.getElementById('tableModeSettings');
      originalSettings.classList.add('hidden');
      tableSettings.classList.add('show');
    })();
    
    // Table image input handler - supports ZIP files, HEIC, and append mode
    document.getElementById('tableImageInput').addEventListener('change', async (event) => {
      const files = Array.from(event.target.files);
      if (files.length === 0) return;
      
      // Process each file (including ZIP files and HEIC)
      const newFiles = [];
      const newImages = [];
      
      for (const file of files) {
        if (file.name.toLowerCase().endsWith('.zip')) {
          // Handle ZIP file
          try {
            const zip = new JSZip();
            const zipContents = await zip.loadAsync(file);
            
            // Get all image files from ZIP
            const imageFiles = [];
            for (const [zipName, zipEntry] of Object.entries(zipContents.files)) {
              if (!zipEntry.dir && zipEntry.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|heic|heif)$/i)) {
                const blob = await zipEntry.async('blob');
                imageFiles.push({
                  name: zipEntry.name,
                  blob: blob,
                  lastModified: file.lastModified
                });
              }
            }
            
            // Sort image files by name
            imageFiles.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
            
            // Add to new files
            for (const imgFile of imageFiles) {
              const newFile = new File([imgFile.blob], imgFile.name, { type: imgFile.blob.type, lastModified: imgFile.lastModified });
              newFiles.push(newFile);
            }
          } catch (err) {
            console.error('Error loading ZIP file:', err);
            alert('無法讀取 ZIP 檔案：' + file.name + '\nFailed to read ZIP file: ' + file.name);
          }
        } else if (file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
          // Handle HEIC/HEIF file - convert to JPEG
          try {
            const convertedBlob = await convertHEICToBlob(file);
            if (convertedBlob) {
              const newFile = new File([convertedBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg', lastModified: file.lastModified });
              newFiles.push(newFile);
            } else {
              alert('無法轉換 HEIC 圖片：' + file.name + '\nUnable to convert HEIC image: ' + file.name);
            }
          } catch (err) {
            console.error('Error converting HEIC file:', err);
            alert('無法轉換 HEIC 圖片：' + file.name + '\nUnable to convert HEIC image: ' + file.name);
          }
        } else if (file.type.startsWith('image/')) {
          // Handle regular image file
          newFiles.push(file);
        }
      }
      
      // Append new files to existing files (don't replace)
      uploadedTableFiles = [...uploadedTableFiles, ...newFiles].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      
      // Load all images (existing + new)
      uploadedTableImages = await Promise.all(uploadedTableFiles.map(file => loadImage(file)));
      
      // Display thumbnails
      displayUploadedImages();
      
      // Update image count display
      updateImageCountDisplay();
      
      // Reset input value to allow re-uploading the same files
      event.target.value = '';
    });
    
    // Display uploaded images thumbnails
    function displayUploadedImages() {
      const container = document.getElementById('uploadedImagesContainer');
      container.innerHTML = '';
      
      uploadedTableImages.forEach((img, index) => {
        const thumb = document.createElement('img');
        thumb.src = img.src;
        thumb.className = 'uploaded-thumb';
        thumb.draggable = true;
        thumb.dataset.index = index;
        
        // Drag events for thumbnails
        thumb.addEventListener('dragstart', (e) => {
          draggedUploadIndex = index;
          thumb.classList.add('dragging');
          e.dataTransfer.setData('text/plain', index);
          e.dataTransfer.effectAllowed = 'copy';
        });
        
        thumb.addEventListener('dragend', () => {
          thumb.classList.remove('dragging');
          draggedUploadIndex = -1;
        });
        
        container.appendChild(thumb);
      });
      
      // Update image count display
      updateImageCountDisplay();
    }
    
    // Update image count display
    function updateImageCountDisplay() {
      const countDisplay = document.getElementById('uploadedImagesCountDisplay');
      const translation = translations[currentLanguage];
      const count = uploadedTableImages.length;
      countDisplay.textContent = translation.uploadedImagesCount.replace('{count}', count.toString());
    }
    
    // Create table grid
    function createTableGrid() {
      tableRows = parseInt(document.getElementById('tableRows').value) || 2;
      tableCols = parseInt(document.getElementById('tableCols').value) || 2;
      
      if (tableRows < 1) tableRows = 1;
      if (tableCols < 1) tableCols = 1;
      
      // Initialize grid
      tableGrid = [];
      for (let i = 0; i < tableRows; i++) {
        tableGrid[i] = [];
        for (let j = 0; j < tableCols; j++) {
          tableGrid[i][j] = null;
        }
      }
      
      // Create HTML grid
      const gridContainer = document.getElementById('tableGrid');
      gridContainer.style.display = 'grid';
      gridContainer.style.gridTemplateColumns = `repeat(${tableCols}, 150px)`;
      gridContainer.style.gridTemplateRows = `repeat(${tableRows}, 150px)`;
      gridContainer.innerHTML = '';
      
      for (let i = 0; i < tableRows; i++) {
        for (let j = 0; j < tableCols; j++) {
          const cell = document.createElement('div');
          cell.className = 'table-cell';
          cell.dataset.row = i;
          cell.dataset.col = j;
          
          // Cell number label
          const cellNum = document.createElement('span');
          cellNum.className = 'cell-number';
          const translation = translations[currentLanguage];
          cellNum.textContent = translation.cellNumber + (i * tableCols + j + 1);
          cell.appendChild(cellNum);
          
          // Remove button
          const removeBtn = document.createElement('button');
          removeBtn.className = 'remove-btn';
          removeBtn.textContent = '×';
          removeBtn.onclick = (e) => {
            e.stopPropagation();
            tableGrid[i][j] = null;
            renderTableGrid();
          };
          cell.appendChild(removeBtn);
          
          // Drag and drop events for dropping from upload area
          cell.addEventListener('dragover', (e) => {
            e.preventDefault();
            cell.classList.add('drag-over');
          });
          
          cell.addEventListener('dragleave', () => {
            cell.classList.remove('drag-over');
          });
          
          cell.addEventListener('drop', (e) => {
            e.preventDefault();
            cell.classList.remove('drag-over');
            
            if (draggedUploadIndex !== -1) {
              // Dropping from uploaded images
              const uploadedImg = uploadedTableImages[draggedUploadIndex];
              // Use original image dimensions or default to 150x150
              const width = uploadedImg.naturalWidth || uploadedImg.width || 150;
              const height = uploadedImg.naturalHeight || uploadedImg.height || 150;
              tableGrid[i][j] = {
                img: uploadedImg,
                file: uploadedTableFiles[draggedUploadIndex],
                width: width,
                height: height
              };
              renderTableGrid();
            } else if (draggedCellIndex !== -1) {
              // Dropping from another cell - swap positions
              const sourceRow = draggedCellIndex.row;
              const sourceCol = draggedCellIndex.col;
              
              if (sourceRow !== i || sourceCol !== j) {
                // Swap images between source and target cells
                const sourceImage = tableGrid[sourceRow][sourceCol];
                const targetImage = tableGrid[i][j];
                
                tableGrid[i][j] = sourceImage;
                tableGrid[sourceRow][sourceCol] = targetImage;
                renderTableGrid();
              }
            }
          });
          
          gridContainer.appendChild(cell);
        }
      }
      
      // Add initial cell size tracking
      cellSizes = Array(tableRows).fill(null).map(() => Array(tableCols).fill({ width: 150, height: 150 }));
      
      document.getElementById('tableGridContainer').style.display = 'flex';
    }
    
    // Switch between move and resize modes
    function switchTableMode(mode) {
      tableOperationMode = mode;
      
      // Update button states
      const moveBtn = document.getElementById('modeSwitchMove');
      const resizeBtn = document.getElementById('modeSwitchResize');
      
      // Update cell styles
      const cells = document.querySelectorAll('.table-cell');
      cells.forEach(cell => {
        if (mode === 'resize') {
          cell.classList.add('resize-mode');
        } else {
          cell.classList.remove('resize-mode');
        }
      });
      
      if (mode === 'move') {
        moveBtn.classList.add('active');
        resizeBtn.classList.remove('active');
      } else {
        resizeBtn.classList.add('active');
        moveBtn.classList.remove('active');
      }
    }
    
    // Render table grid
    function renderTableGrid() {
      const cells = document.querySelectorAll('.table-cell');
      const translation = translations[currentLanguage];
      
      cells.forEach(cell => {
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);
        
        // Keep the cell number and remove button
        const cellNum = cell.querySelector('.cell-number');
        const removeBtn = cell.querySelector('.remove-btn');
        
        // Remove existing images and size display
        const existingImg = cell.querySelector('.cell-image');
        const existingSizeDisplay = cell.querySelector('.size-display');
        if (existingImg) existingImg.remove();
        if (existingSizeDisplay) existingSizeDisplay.remove();
        
        // Add image if exists
        if (tableGrid[row][col]) {
          cell.classList.add('has-image');
          const imgData = tableGrid[row][col];
          const img = document.createElement('img');
          img.src = imgData.img.src;
          img.className = 'cell-image';
          img.draggable = true;
          img.style.width = imgData.width + 'px';
          img.style.height = imgData.height + 'px';
          
          // Add size display
          const sizeDisplay = document.createElement('div');
          sizeDisplay.className = 'size-display';
          sizeDisplay.textContent = imgData.width + ' x ' + imgData.height;
          
          // Click to resize - show percentage input
          img.addEventListener('click', (e) => {
            if (tableOperationMode !== 'resize') {
              return;
            }
            e.stopPropagation();
            
            // Get original dimensions
            const originalWidth = img.naturalWidth || imgData.width;
            const originalHeight = img.naturalHeight || imgData.height;
            
            // Show percentage input
            const newPercent = prompt('輸入縮放百分比 (e.g., 50 = 50%, 125 = 125%):', 
              Math.round((imgData.width / originalWidth) * 100));
            
            if (newPercent !== null && newPercent !== '') {
              const percent = parseFloat(newPercent);
              if (!isNaN(percent) && percent > 0) {
                // Calculate new dimensions
                const newWidth = Math.max(50, Math.round(originalWidth * percent / 100));
                const newHeight = Math.max(50, Math.round(originalHeight * percent / 100));
                
                // Update image display
                img.style.width = newWidth + 'px';
                img.style.height = newHeight + 'px';
                
                // Update size display
                sizeDisplay.textContent = newWidth + ' x ' + newHeight;
                
                // Store in tableGrid
                imgData.width = newWidth;
                imgData.height = newHeight;
              } else {
                alert('請輸入有效的數字！');
              }
            }
          });
          
          // Add drag events for moving between cells
          img.addEventListener('dragstart', (e) => {
            if (tableOperationMode !== 'move') {
              e.preventDefault();
              return;
            }
            if (isResizing) {
              e.preventDefault();
              return;
            }
            draggedCellIndex = { row: row, col: col };
            draggedUploadIndex = -1;
            e.dataTransfer.setData('text/plain', JSON.stringify({row, col}));
            e.dataTransfer.effectAllowed = 'move';
            cell.classList.add('dragging');
          });
          
          img.addEventListener('dragend', () => {
            draggedCellIndex = -1;
            cell.classList.remove('dragging');
          });
          
          // Prevent cell click from removing image
          img.addEventListener('click', (e) => {
            e.stopPropagation();
          });
          
          // Prevent cell click from removing image
          cell.addEventListener('click', (e) => {
            // Only remove if clicked directly on cell background (not on image or controls)
            if (e.target === cell) {
              tableGrid[row][col] = null;
              renderTableGrid();
            }
          });
          
          cell.appendChild(sizeDisplay);
          cell.appendChild(img);
        } else {
          cell.classList.remove('has-image');
        }
      });
    }
    
    // Auto-fill table
    function autoFillTable(order) {
      if (uploadedTableImages.length === 0) {
        alert('請先上傳圖片！\nPlease upload images first!');
        return;
      }
      
      // Clear grid first
      for (let i = 0; i < tableRows; i++) {
        for (let j = 0; j < tableCols; j++) {
          tableGrid[i][j] = null;
        }
      }
      
      // Sort images
      let sortedImages = [...uploadedTableImages];
      let sortedFiles = [...uploadedTableFiles];
      
      if (order === 'desc') {
        sortedImages.reverse();
        sortedFiles.reverse();
      }
      
      // Fill grid
      let imgIndex = 0;
      for (let i = 0; i < tableRows && imgIndex < sortedImages.length; i++) {
        for (let j = 0; j < tableCols && imgIndex < sortedImages.length; j++) {
          const uploadedImg = sortedImages[imgIndex];
          const width = uploadedImg.naturalWidth || uploadedImg.width || 150;
          const height = uploadedImg.naturalHeight || uploadedImg.height || 150;
          tableGrid[i][j] = {
            img: sortedImages[imgIndex],
            file: sortedFiles[imgIndex],
            width: width,
            height: height
          };
          imgIndex++;
        }
      }
      
      renderTableGrid();
    }
    
    // Clear all uploaded images (thumbnails and files)
    function clearAllUploadedImages() {
      uploadedTableFiles = [];
      uploadedTableImages = [];
      document.getElementById('uploadedImagesContainer').innerHTML = '';
      document.getElementById('uploadedImagesCountDisplay').textContent = '';
      document.getElementById('tableImageInput').value = '';
    }
    
    // Clear table (grid cells only)
    function clearTable() {
      for (let i = 0; i < tableRows; i++) {
        for (let j = 0; j < tableCols; j++) {
          tableGrid[i][j] = null;
        }
      }
      renderTableGrid();
    }
    
    // Merge table images
    async function mergeTableImages() {
      // Get spacing values from inputs
      const rowSpacing = parseInt(document.getElementById('tableRowSpacing').value) || 0;
      const colSpacing = parseInt(document.getElementById('tableColSpacing').value) || 0;
      
      // Collect all non-empty cells and calculate max dimensions per row and column
      const cellsWithImages = [];
      const rowHeights = new Array(tableRows).fill(0);
      const colWidths = new Array(tableCols).fill(0);
      
      for (let i = 0; i < tableRows; i++) {
        for (let j = 0; j < tableCols; j++) {
          if (tableGrid[i][j]) {
            const cellData = tableGrid[i][j];
            const img = cellData.img;
            // Use custom width/height if available, otherwise use original dimensions
            const width = cellData.width || img.width;
            const height = cellData.height || img.height;
            cellsWithImages.push({
              row: i,
              col: j,
              img: img,
              customWidth: width,
              customHeight: height
            });
            // Track max dimensions for each row and column
            rowHeights[i] = Math.max(rowHeights[i], height);
            colWidths[j] = Math.max(colWidths[j], width);
          }
        }
      }
      
      if (cellsWithImages.length === 0) {
        alert('請先在表格中放置圖片！\nPlease place images in the table first!');
        return;
      }
      
      // Calculate canvas size based on actual image dimensions
      let totalWidth = 0;
      let totalHeight = 0;
      
      for (let j = 0; j < tableCols; j++) {
        totalWidth += colWidths[j];
        if (j < tableCols - 1) totalWidth += colSpacing;
      }
      
      for (let i = 0; i < tableRows; i++) {
        totalHeight += rowHeights[i];
        if (i < tableRows - 1) totalHeight += rowSpacing;
      }
      
      // Use table preview canvas instead of shared preview
      const canvas = document.getElementById('tablePreview');
      const ctx = canvas.getContext('2d');
      
      canvas.width = totalWidth;
      canvas.height = totalHeight;
      
      // Fill white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, totalWidth, totalHeight);
      
      // Calculate x and y offsets for each cell
      const xOffsets = new Array(tableCols).fill(0);
      const yOffsets = new Array(tableRows).fill(0);
      
      for (let j = 1; j < tableCols; j++) {
        xOffsets[j] = xOffsets[j-1] + colWidths[j-1] + colSpacing;
      }
      for (let i = 1; i < tableRows; i++) {
        yOffsets[i] = yOffsets[i-1] + rowHeights[i-1] + rowSpacing;
      }
      
      // Draw images
      cellsWithImages.forEach(cell => {
        const x = xOffsets[cell.col];
        const y = yOffsets[cell.row];
        const cellWidth = colWidths[cell.col];
        const cellHeight = rowHeights[cell.row];
        
        // Draw white background for cell
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, cellWidth, cellHeight);
        
        // Draw image at custom size (maintaining aspect ratio within custom dimensions)
        const img = cell.img;
        const customWidth = cell.customWidth || img.width;
        const customHeight = cell.customHeight || img.height;
        
        // Scale the image to fit within the custom dimensions while maintaining aspect ratio
        const scale = Math.min(customWidth / img.width, customHeight / img.height);
        const drawWidth = img.width * scale;
        const drawHeight = img.height * scale;
        const drawX = x + (customWidth - drawWidth) / 2;
        const drawY = y + (customHeight - drawHeight) / 2;
        
        ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      });
      
      // Store data URL and show download button
      tableCanvasDataUrl = canvas.toDataURL('image/png');
      document.getElementById('tableDownloadButton').style.display = 'inline-block';
      document.getElementById('tableResultContainer').classList.add('show');
    }
    
    let tableCanvasDataUrl = '';
    
    // Download table merged image
    async function downloadTableImage() {
      const canvas = document.getElementById('tablePreview');
      try {
        if ('showSaveFilePicker' in window) {
          const fileHandle = await window.showSaveFilePicker({
            suggestedName: 'merged_table_image.png',
            types: [{
              description: 'PNG Image',
              accept: { 'image/png': ['.png'] }
            }]
          });
          const writable = await fileHandle.createWritable();
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          await writable.write(blob);
          await writable.close();
        } else {
          const link = document.createElement('a');
          link.href = tableCanvasDataUrl;
          link.download = 'merged_table_image.png';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      } catch (err) {
        console.error('下載失敗:\nDownload failed:', err);
        const link = document.createElement('a');
        link.href = tableCanvasDataUrl;
        link.download = 'merged_table_image.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }
        
        // Draw white background for cell
        ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, cellWidth, cellHeight);
    
    // Draw image scaled to fit (maintaining aspect ratio)
    const img = cell.img;
    const scale = Math.min(cellWidth / img.width, cellHeight / img.height);
    const drawWidth = img.width * scale;
    const drawHeight = img.height * scale;
    const drawX = x + (cellWidth - drawWidth) / 2;
    const drawY = y + (cellHeight - drawHeight) / 2;
    
    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
    
    canvasDataUrl = canvas.toDataURL('image/png');
    document.getElementById('downloadButton').style.display = 'inline-block';

    // 處理檔案輸入變化以初始化圖片，並按名稱正序合併 - 支援 ZIP 和追加模式
    document.getElementById('imageInput').addEventListener('change', async (event) => {
      const files = Array.from(event.target.files);
      if (files.length === 0) return;

      // Process each file (including ZIP files)
      const newFiles = [];
      
      for (const file of files) {
        if (file.name.toLowerCase().endsWith('.zip')) {
          // Handle ZIP file
          try {
            const zip = new JSZip();
            const zipContents = await zip.loadAsync(file);
            
            // Get all image files from ZIP
            const imageFiles = [];
            for (const [zipName, zipEntry] of Object.entries(zipContents.files)) {
              if (!zipEntry.dir && zipEntry.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|heic|heif)$/i)) {
                const blob = await zipEntry.async('blob');
                imageFiles.push({
                  name: zipEntry.name,
                  blob: blob,
                  lastModified: file.lastModified
                });
              }
            }
            
            // Sort image files by name
            imageFiles.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
            
            // Add to new files
            for (const imgFile of imageFiles) {
              const newFile = new File([imgFile.blob], imgFile.name, { type: imgFile.blob.type, lastModified: imgFile.lastModified });
              newFiles.push(newFile);
            }
          } catch (err) {
            console.error('Error loading ZIP file:', err);
            alert('無法讀取 ZIP 檔案：' + file.name + '\nFailed to read ZIP file: ' + file.name);
          }
        } else if (file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
          // Handle HEIC/HEIF file - convert to JPEG
          try {
            const convertedBlob = await convertHEICToBlob(file);
            if (convertedBlob) {
              const newFile = new File([convertedBlob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg', lastModified: file.lastModified });
              newFiles.push(newFile);
            } else {
              alert('無法轉換 HEIC 圖片：' + file.name + '\nUnable to convert HEIC image: ' + file.name);
            }
          } catch (err) {
            console.error('Error converting HEIC file:', err);
            alert('無法轉換 HEIC 圖片：' + file.name + '\nUnable to convert HEIC image: ' + file.name);
          }
        } else if (file.type.startsWith('image/')) {
          // Handle regular image file
          newFiles.push(file);
        }
      }
      
      // Append new files to existing files (don't replace)
      imageFiles = [...imageFiles, ...newFiles].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      
      if (imageFiles.length === 0) return;

      // Load all images (existing + new)
      images = await Promise.all(imageFiles.map(file => loadImage(file)));
      await mergeImages('asc');
      
      // Reset input value to allow re-uploading the same files
      event.target.value = '';
    });

    // 處理間距和每行圖片數量輸入變化，重新繪製畫布
    document.getElementById('rowSpacing').addEventListener('input', () => {
      if (images.length > 0) mergeImages('custom');
    });
    document.getElementById('colSpacing').addEventListener('input', () => {
      if (images.length > 0) mergeImages('custom');
    });
    document.getElementById('imagesPerRow').addEventListener('input', () => {
      if (images.length > 0) mergeImages('custom');
    });

    // 在畫布上繪 ترکیب圖片並儲存位置
    function drawImages(ctx, images, imagesPerRow, rowSpacing, colSpacing, highlightIndex = -1, dropTargetIndex = -1) {
      imagePositions = [];
      let maxRowWidth = 0;
      let totalHeight = rowSpacing; // 為第一行上方添加行間距
      let currentRowWidth = 0;
      let currentRowHeight = 0;
      let rowWidths = [];
      let rowHeights = [];
      let currentRowImages = 0;
      let xOffset = 0;
      let yOffset = rowSpacing; // 初始 yOffset 為行間距
      let rowIndex = 0;
      let imagesInCurrentRow = 0;

      images.forEach((img) => {
        if (imagesPerRow > 0 && currentRowImages >= imagesPerRow) {
          // 每行包含所有圖片的列間距
          rowWidths.push(currentRowWidth + (currentRowImages - 1) * colSpacing);
          rowHeights.push(currentRowHeight);
          maxRowWidth = Math.max(maxRowWidth, currentRowWidth + (currentRowImages - 1) * colSpacing);
          totalHeight += currentRowHeight + rowSpacing; // 包含下方行間距
          currentRowWidth = 0;
          currentRowHeight = 0;
          currentRowImages = 0;
        }
        currentRowWidth += img.width;
        currentRowHeight = Math.max(currentRowHeight, img.height);
        currentRowImages++;
      });

      if (currentRowImages > 0) {
        rowWidths.push(currentRowWidth + (currentRowImages - 1) * colSpacing);
        rowHeights.push(currentRowHeight);
        maxRowWidth = Math.max(maxRowWidth, currentRowWidth + (currentRowImages - 1) * colSpacing);
        totalHeight += currentRowHeight;
      }

      // 設置畫布尺寸
      ctx.canvas.width = maxRowWidth;
      ctx.canvas.height = totalHeight;

      // 清除畫布以保持透明背景
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      // 繪製間距的白色背景
      images.forEach((img, index) => {
        if (imagesPerRow > 0 && imagesInCurrentRow >= imagesPerRow) {
          xOffset = 0;
          yOffset += rowHeights[rowIndex] + rowSpacing; // 包含上方行間距
          rowIndex++;
          imagesInCurrentRow = 0;
        }

        // 繪製圖片及其間距區域的白色背景
        ctx.fillStyle = '#ffffff';
        // 繪製圖片區域
        ctx.fillRect(xOffset, yOffset, img.width, img.height);
        // 繪製右側列間距（除了每行最後一張圖片）
        if (imagesInCurrentRow < (imagesPerRow || images.length) - 1) {
          ctx.fillRect(xOffset + img.width, yOffset, colSpacing, img.height);
        }
        // 繪製第一行或每行上方的行間距
        if (imagesInCurrentRow === 0) {
          ctx.fillRect(0, yOffset - rowSpacing, maxRowWidth, rowSpacing);
        }

        if (index !== highlightIndex) {
          ctx.drawImage(img, xOffset, yOffset, img.width, img.height);
        }
        imagePositions.push({
          index,
          x: xOffset,
          y: yOffset,
          width: img.width,
          height: img.height
        });
        if (index === highlightIndex) {
          ctx.globalAlpha = 0.5;
          ctx.drawImage(img, xOffset, yOffset, img.width, img.height);
          ctx.globalAlpha = 1.0;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.font = '12px Arial';
          ctx.fillText(imageFiles[index].name, xOffset, yOffset + img.height - 5);
        }
        if (index === dropTargetIndex) {
          ctx.strokeStyle = '#007bff';
          ctx.lineWidth = 2;
          ctx.strokeRect(xOffset, yOffset, img.width, img.height);
        }
        xOffset += img.width + colSpacing; // 每張圖片後增加列間距
        imagesInCurrentRow++;
      });

      return { maxRowWidth, totalHeight, rowWidths, rowHeights };
    }

    // 根據畫布座標找到圖片索引，考慮縮放比例
    function getImageAtPosition(x, y, canvas) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const canvasX = x * scaleX;
      const canvasY = y * scaleY;
      return imagePositions.findIndex(pos =>
        canvasX >= pos.x && canvasX <= pos.x + pos.width &&
        canvasY >= pos.y && canvasY <= pos.y + pos.height
      );
    }

    async function mergeImages(order) {
      const input = document.getElementById('imageInput');
      const imagesPerRowInput = document.getElementById('imagesPerRow');
      const rowSpacingInput = document.getElementById('rowSpacing');
      const colSpacingInput = document.getElementById('colSpacing');
      const canvas = document.getElementById('preview');
      const ctx = canvas.getContext('2d');
      const downloadButton = document.getElementById('downloadButton');
      let files = imageFiles.length > 0 ? imageFiles : Array.from(input.files);

      if (files.length === 0) {
        alert('請先選擇圖片！\nPlease select an image first!');
        return;
      }

      let imagesPerRow = parseInt(imagesPerRowInput.value) || 0;
      if (imagesPerRow < 0) imagesPerRow = 0;
      let rowSpacing = parseInt(rowSpacingInput.value) || 0;
      if (rowSpacing < 0) rowSpacing = 0;
      let colSpacing = parseInt(colSpacingInput.value) || 0;
      if (colSpacing < 0) colSpacing = 0;

      if (order === 'asc') {
        files = files.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        imageFiles = files;
        images = await Promise.all(files.map(file => loadImage(file)));
      } else if (order === 'desc') {
        files = files.sort((a, b) => b.name.toLowerCase().localeCompare(a.name.toLowerCase()));
        imageFiles = files;
        images = await Promise.all(files.map(file => loadImage(file)));
      }

      drawImages(ctx, images, imagesPerRow, rowSpacing, colSpacing);

      canvasDataUrl = canvas.toDataURL('image/png');
      downloadButton.style.display = 'inline-block';
      
      // Check if current mode is imagesPerRow (not table mode)
      const currentMode = document.querySelector('input[name="mode"]:checked').value;
      if (currentMode === 'imagesPerRow') {
        // Hide table result, show images per row result
        document.getElementById('tableResultContainer').classList.remove('show');
        document.getElementById('originalResultContainer').classList.add('show');
      }
    }

    // 處理畫布上的拖放
    const canvas = document.getElementById('preview');
    let startX, startY;
    let dragPreview = null;
    let dragLabel = null;

    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;
      draggedIndex = getImageAtPosition(startX, startY, canvas);
      if (draggedIndex !== -1) {
        isDragging = true;
        canvas.classList.add('dragging');

        // 創建拖動預覽圖片
        dragPreview = document.createElement('img');
        dragPreview.id = 'dragPreview';
        dragPreview.src = images[draggedIndex].src;
        document.body.appendChild(dragPreview);

        // 創建拖動標籤
        dragLabel = document.createElement('div');
        dragLabel.id = 'dragLabel';
        dragLabel.textContent = imageFiles[draggedIndex].name;
        document.body.appendChild(dragLabel);

        const ctx = canvas.getContext('2d');
        drawImages(ctx, images, parseInt(document.getElementById('imagesPerRow').value) || 0,
                   parseInt(document.getElementById('rowSpacing').value) || 0,
                   parseInt(document.getElementById('colSpacing').value) || 0, draggedIndex);
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const targetIndex = getImageAtPosition(x, y, canvas);

      // 更新拖動預覽位置
      if (dragPreview) {
        dragPreview.style.left = `${e.clientX + 10}px`;
        dragPreview.style.top = `${e.clientY + 10}px`;
      }
      if (dragLabel) {
        dragLabel.style.left = `${e.clientX + 10}px`;
        dragLabel.style.top = `${e.clientY + 30}px`;
      }

      const ctx = canvas.getContext('2d');
      drawImages(ctx, images, parseInt(document.getElementById('imagesPerRow').value) || 0,
                 parseInt(document.getElementById('rowSpacing').value) || 0,
                 parseInt(document.getElementById('colSpacing').value) || 0, draggedIndex, targetIndex);
    });

    canvas.addEventListener('mouseup', async (e) => {
      if (!isDragging) return;
      isDragging = false;
      canvas.classList.remove('dragging');
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const targetIndex = getImageAtPosition(x, y, canvas);
      if (draggedIndex !== -1 && targetIndex !== -1 && draggedIndex !== targetIndex) {
        // 交換圖片
        [images[draggedIndex], images[targetIndex]] = [images[targetIndex], images[draggedIndex]];
        [imageFiles[draggedIndex], imageFiles[targetIndex]] = [imageFiles[targetIndex], imageFiles[draggedIndex]];
        const ctx = canvas.getContext('2d');
        // 重新計算畫布尺寸並繪製
        drawImages(ctx, images, parseInt(document.getElementById('imagesPerRow').value) || 0,
                   parseInt(document.getElementById('rowSpacing').value) || 0,
                   parseInt(document.getElementById('colSpacing').value) || 0);
        canvasDataUrl = canvas.toDataURL('image/png');
      }
      draggedIndex = -1;
      // 移除拖動預覽和標籤
      if (dragPreview) {
        dragPreview.remove();
        dragPreview = null;
      }
      if (dragLabel) {
        dragLabel.remove();
        dragLabel = null;
      }
      // 確保最終畫布重新繪製
      const ctx = canvas.getContext('2d');
      drawImages(ctx, images, parseInt(document.getElementById('imagesPerRow').value) || 0,
                 parseInt(document.getElementById('rowSpacing').value) || 0,
                 parseInt(document.getElementById('colSpacing').value) || 0);
    });

    canvas.addEventListener('mouseleave', () => {
      if (isDragging) {
        isDragging = false;
        canvas.classList.remove('dragging');
        draggedIndex = -1;
        if (dragPreview) {
          dragPreview.remove();
          dragPreview = null;
        }
        if (dragLabel) {
          dragLabel.remove();
          dragLabel = null;
        }
        const ctx = canvas.getContext('2d');
        drawImages(ctx, images, parseInt(document.getElementById('imagesPerRow').value) || 0,
                   parseInt(document.getElementById('rowSpacing').value) || 0,
                   parseInt(document.getElementById('colSpacing').value) || 0);
      }
    });

    // 保留拖放事件作為備用
    canvas.addEventListener('dragstart', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      draggedIndex = getImageAtPosition(x, y, canvas);
      if (draggedIndex !== -1) {
        e.dataTransfer.setData('text/plain', draggedIndex);
        canvas.classList.add('dragging');
        dragPreview = document.createElement('img');
        dragPreview.id = 'dragPreview';
        dragPreview.src = images[draggedIndex].src;
        document.body.appendChild(dragPreview);
        dragLabel = document.createElement('div');
        dragLabel.id = 'dragLabel';
        dragLabel.textContent = imageFiles[draggedIndex].name;
        document.body.appendChild(dragLabel);
        const ctx = canvas.getContext('2d');
        drawImages(ctx, images, parseInt(document.getElementById('imagesPerRow').value) || 0,
                   parseInt(document.getElementById('rowSpacing').value) || 0,
                   parseInt(document.getElementById('colSpacing').value) || 0, draggedIndex);
      }
    });

    canvas.addEventListener('dragover', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const targetIndex = getImageAtPosition(x, y, canvas);
      if (dragPreview) {
        dragPreview.style.left = `${e.clientX + 10}px`;
        dragPreview.style.top = `${e.clientY + 10}px`;
      }
      if (dragLabel) {
        dragLabel.style.left = `${e.clientX + 10}px`;
        dragLabel.style.top = `${e.clientY + 30}px`;
      }
      if (targetIndex !== -1) {
        const ctx = canvas.getContext('2d');
        drawImages(ctx, images, parseInt(document.getElementById('imagesPerRow').value) || 0,
                   parseInt(document.getElementById('rowSpacing').value) || 0,
                   parseInt(document.getElementById('colSpacing').value) || 0, draggedIndex, targetIndex);
      }
    });

    canvas.addEventListener('dragend', () => {
      canvas.classList.remove('dragging');
      draggedIndex = -1;
      if (dragPreview) {
        dragPreview.remove();
        dragPreview = null;
      }
      if (dragLabel) {
        dragLabel.remove();
        dragLabel = null;
      }
      const ctx = canvas.getContext('2d');
      drawImages(ctx, images, parseInt(document.getElementById('imagesPerRow').value) || 0,
                 parseInt(document.getElementById('rowSpacing').value) || 0,
                 parseInt(document.getElementById('colSpacing').value) || 0);
    });

    canvas.addEventListener('drop', async (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const targetIndex = getImageAtPosition(x, y, canvas);
      if (draggedIndex !== -1 && targetIndex !== -1 && draggedIndex !== targetIndex) {
        // 交換圖片
        [images[draggedIndex], images[targetIndex]] = [images[targetIndex], images[draggedIndex]];
        [imageFiles[draggedIndex], imageFiles[targetIndex]] = [imageFiles[targetIndex], imageFiles[draggedIndex]];
        const ctx = canvas.getContext('2d');
        // 重新計算畫布尺寸並繪製
        drawImages(ctx, images, parseInt(document.getElementById('imagesPerRow').value) || 0,
                   parseInt(document.getElementById('rowSpacing').value) || 0,
                   parseInt(document.getElementById('colSpacing').value) || 0);
        canvasDataUrl = canvas.toDataURL('image/png');
      }
      draggedIndex = -1;
      canvas.classList.remove('dragging');
      if (dragPreview) {
        dragPreview.remove();
        dragPreview = null;
      }
      if (dragLabel) {
        dragLabel.remove();
        dragLabel = null;
      }
      // 確保最終畫布重新繪製
      const ctx = canvas.getContext('2d');
      drawImages(ctx, images, parseInt(document.getElementById('imagesPerRow').value) || 0,
                 parseInt(document.getElementById('rowSpacing').value) || 0,
                 parseInt(document.getElementById('colSpacing').value) || 0);
    });

    async function downloadMergedImage() {
      const canvas = document.getElementById('preview');
      try {
        if ('showSaveFilePicker' in window) {
          const fileHandle = await window.showSaveFilePicker({
            suggestedName: 'merged_image.png',
            types: [{
              description: 'PNG Image',
              accept: { 'image/png': ['.png'] }
            }]
          });
          const writable = await fileHandle.createWritable();
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          await writable.write(blob);
          await writable.close();
        } else {
          const link = document.createElement('a');
          link.href = canvasDataUrl;
          link.download = 'merged_image.png';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      } catch (err) {
        console.error('下載失敗:\nDownload failed:', err);
        alert('無法保存文件，可能是因為瀏覽器不支持或用戶取消了操作。\nUnable to save the file. This might be due to browser incompatibility or user cancellation. Please try again.');
        const link = document.createElement('a');
        link.href = canvasDataUrl;
        link.download = 'merged_image.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }

    function loadImage(file) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
    }
