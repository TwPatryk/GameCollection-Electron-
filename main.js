const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const Database = require('./database');

let mainWindow;
let server;
let db;
const PORT = 3000;

// Get the application directory (where the executable/main files are located)
function getAppDataPath() {
  // In development, use the current directory
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    return __dirname;
  }
  
  // In production, use the directory where the executable is located
  // This ensures the app is portable
  if (app.isPackaged) {
    return path.dirname(process.execPath);
  } else {
    return __dirname;
  }
}

async function renameGameFolder(oldTitle, newTitle) {
  try {
    const oldFolderName = sanitizeFolderName(oldTitle);
    const newFolderName = sanitizeFolderName(newTitle);
    
    const uploadsPath = path.join(getAppDataPath(), 'uploads');
    const oldPath = path.join(uploadsPath, oldFolderName);
    const newPath = path.join(uploadsPath, newFolderName);
    
    if (fs.existsSync(oldPath) && oldFolderName !== newFolderName) {
      // Create new directory if it doesn't exist
      if (!fs.existsSync(newPath)) {
        fs.mkdirSync(newPath, { recursive: true });
      }
      
      // Move all files from old directory to new directory
      const files = fs.readdirSync(oldPath);
      for (const file of files) {
        const oldFilePath = path.join(oldPath, file);
        const newFilePath = path.join(newPath, file);
        fs.renameSync(oldFilePath, newFilePath);
      }
      
      // Remove old directory only if it's empty
      try {
        fs.rmdirSync(oldPath);
      } catch (err) {
        console.warn(`Could not remove old directory ${oldPath}:`, err.message);
      }
      
      return { success: true, oldPath, newPath };
    }
    return { success: false, message: 'No changes needed or folder not found' };
  } catch (error) {
    console.error('Error renaming game folder:', error);
    return { success: false, message: error.message };
  }
}

// Initialize database and server
async function initializeApp() {
  try {
    // Initialize database
    db = new Database();
    await db.initialize();
    
    // Start Express server
    const expressApp = express();
    
    // Configure multer for file uploads
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        const gameTitle = req.body.title || 'temp';
        const folderName = sanitizeFolderName(gameTitle);
        const uploadDir = path.join(getAppDataPath(), 'uploads', folderName);
        
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        const prefix = file.fieldname === 'coverArt' ? 'cover_' : 'gameplay_';
        const extension = path.extname(file.originalname);
        cb(null, prefix + uuidv4() + extension);
      }
    });
    
    const upload = multer({ storage });
    
    expressApp.use(express.json());
    expressApp.use(express.urlencoded({ extended: true }));
    
    // Serve uploaded files
    const uploadsPath = path.join(getAppDataPath(), 'uploads');
    expressApp.use('/uploads', express.static(uploadsPath));
	
	    // Configure multer for additional photos
    const photoStorage = multer.diskStorage({
      destination: (req, file, cb) => {
        const gameId = req.params.id;
        // Get the game to find its title
        db.getGameById(gameId).then(game => {
          if (!game) {
            return cb(new Error('Game not found'));
          }
          const folderName = sanitizeFolderName(game.title);
          const uploadDir = path.join(getAppDataPath(), 'uploads', folderName);
          
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          cb(null, uploadDir);
        }).catch(err => {
          cb(err);
        });
      },
      filename: (req, file, cb) => {
        const uniqueName = 'additional_' + uuidv4() + path.extname(file.originalname);
        cb(null, uniqueName);
      }
    });

    const photoUpload = multer({ storage: photoStorage });

    // Add photo to game
    expressApp.post('/games/:id/add-photo', photoUpload.single('photo'), async (req, res) => {
      try {
        console.log('Add photo endpoint called for game:', req.params.id);
        
        const gameId = req.params.id;
        const game = await db.getGameById(gameId);
        
        if (!game) {
          console.log('Game not found:', gameId);
          return res.status(404).json({ error: 'Game not found' });
        }
        
        if (!req.file) {
          console.log('No file uploaded');
          return res.status(400).json({ error: 'No photo uploaded' });
        }

        console.log('File uploaded successfully:', req.file.filename);
        
        const folderName = sanitizeFolderName(game.title);
        const photoPath = `http://localhost:${PORT}/uploads/${folderName}/${req.file.filename}`;
        
        // Get existing additionalPhotos
        const additionalPhotos = game.additionalPhotos || [];
        
        // Add new photo
        additionalPhotos.push({
          path: photoPath,
          filename: req.file.filename,
          dateAdded: new Date().toISOString()
        });
        
        console.log('Updated photos array:', additionalPhotos);
        
        // Update the game in database
        await db.updateGame(gameId, { 
          additionalPhotos: additionalPhotos
        });
        
        console.log('Photo added to database successfully');
        res.json({ 
          message: 'Photo added successfully',
          photo: {
            path: photoPath,
            filename: req.file.filename
          }
        });
        
      } catch (error) {
        console.error('Error adding photo:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Add note to game
    expressApp.post('/games/:id/add-note', async (req, res) => {
      try {
        console.log('Add note endpoint called for game:', req.params.id);
        
        const gameId = req.params.id;
        const game = await db.getGameById(gameId);
        
        if (!game) {
          return res.status(404).json({ error: 'Game not found' });
        }
        
        const { content } = req.body;
        if (!content || content.trim() === '') {
          return res.status(400).json({ error: 'Note content is required' });
        }
        
        // Get existing additionalNotes
        const additionalNotes = game.additionalNotes || [];
        
        // Add new note
        additionalNotes.push({
          content: content.trim(),
          dateAdded: new Date().toISOString()
        });
        
        console.log('Updated notes array:', additionalNotes);
        
        await db.updateGame(gameId, { 
          additionalNotes: additionalNotes
        });
        
        res.json({ message: 'Note added successfully' });
      } catch (error) {
        console.error('Error adding note:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Delete photo from game
    expressApp.delete('/games/:id/delete-photo/:photoIndex', async (req, res) => {
      try {
        const gameId = req.params.id;
        const photoIndex = parseInt(req.params.photoIndex);
        const game = await db.getGameById(gameId);
        
        if (!game) {
          return res.status(404).json({ error: 'Game not found' });
        }
        
        const additionalPhotos = game.additionalPhotos || [];
        
        if (photoIndex < 0 || photoIndex >= additionalPhotos.length) {
          return res.status(400).json({ error: 'Invalid photo index' });
        }
        
        // Delete the file from filesystem
        const photoToDelete = additionalPhotos[photoIndex];
        const filePath = photoToDelete.path.replace(`http://localhost:${PORT}`, getAppDataPath());
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        
        // Remove from array
        additionalPhotos.splice(photoIndex, 1);
        
        await db.updateGame(gameId, { 
          additionalPhotos: additionalPhotos
        });
        
        res.json({ message: 'Photo deleted successfully' });
      } catch (error) {
        console.error('Error deleting photo:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Delete note from game
    expressApp.delete('/games/:id/delete-note/:noteIndex', async (req, res) => {
      try {
        const gameId = req.params.id;
        const noteIndex = parseInt(req.params.noteIndex);
        const game = await db.getGameById(gameId);
        
        if (!game) {
          return res.status(404).json({ error: 'Game not found' });
        }
        
        const additionalNotes = game.additionalNotes || [];
        
        if (noteIndex < 0 || noteIndex >= additionalNotes.length) {
          return res.status(400).json({ error: 'Invalid note index' });
        }
        
        // Remove from array
        additionalNotes.splice(noteIndex, 1);
        
        await db.updateGame(gameId, { 
          additionalNotes: additionalNotes
        });
        
        res.json({ message: 'Note deleted successfully' });
      } catch (error) {
        console.error('Error deleting note:', error);
        res.status(500).json({ error: error.message });
      }
    });
    
    // API Routes
	expressApp.get('/games/list', async (req, res) => {
	  try {
		const games = await db.getAllGames();
		// Ensure dateAdded is properly formatted as ISO string
		const formattedGames = games.map(game => ({
		  ...game,
		  dateAdded: new Date(game.dateAdded).toISOString()
		}));
		res.json(formattedGames);
	  } catch (error) {
		res.status(500).json({ error: error.message });
	  }
	});
    
    expressApp.post('/games/create', upload.fields([
      { name: 'coverArt', maxCount: 1 },
      { name: 'gameplayImage', maxCount: 1 }
    ]), async (req, res) => {
      try {
        const gameData = {
          title: req.body.title,
          link: req.body.link || '',
          rageRating: parseInt(req.body.rageRating) || 0,
          finished: req.body.finished === 'true',
		  is_checked: req.body.is_checked === 'true',
          platform: req.body.platform || '',
          strikes: parseInt(req.body.strikes) || 0,
          notes: req.body.notes || '',
          coverArtPath: null,
          gameplayImagePath: null
        };
        
        const folderName = sanitizeFolderName(gameData.title);
        
        if (req.files && req.files.coverArt) {
          gameData.coverArtPath = `http://localhost:${PORT}/uploads/${folderName}/${req.files.coverArt[0].filename}`;
        }
        
        if (req.files && req.files.gameplayImage) {
          gameData.gameplayImagePath = `http://localhost:${PORT}/uploads/${folderName}/${req.files.gameplayImage[0].filename}`;
        }
        
        const gameId = await db.createGame(gameData);
        res.json({ id: gameId, message: 'Game created successfully' });
      } catch (error) {
        console.error('Create game error:', error);
        res.status(500).json({ error: error.message });
      }
    });
		
	expressApp.post('/games/bulk-create', async (req, res) => {
	  try {
		const { titles } = req.body;
		
		if (!titles || !Array.isArray(titles)) {
		  return res.status(400).json({ error: 'Invalid request: titles array required' });
		}

		let createdCount = 0;
		for (const title of titles) {
		  if (typeof title === 'string' && title.trim() !== '') {
			const gameData = {
			  title: title.trim(),
			  link: '',
			  rageRating: 0,
			  finished: false,
			  platform: '',
			  strikes: 0,
			  notes: '',
			  coverArtPath: null,
			  gameplayImagePath: null
			};
			
			await db.createGame(gameData);
			createdCount++;
		  }
		}

		res.json({ createdCount, message: `Successfully created ${createdCount} new entries` });
	  } catch (error) {
		console.error('Bulk create error:', error);
		res.status(500).json({ error: error.message });
	  }
	});
    
    expressApp.get('/games/:id', async (req, res) => {
      try {
        const game = await db.getGameById(req.params.id);
        if (!game) {
          return res.status(404).json({ error: 'Game not found' });
        }
        res.json(game);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
	expressApp.post('/games/update/:id', upload.fields([
	  { name: 'coverArt', maxCount: 1 },
	  { name: 'gameplayImage', maxCount: 1 }
	]), async (req, res) => {
	  try {
		const gameId = req.params.id;
		const existingGame = await db.getGameById(gameId);
		
		if (!existingGame) {
		  return res.status(404).json({ error: 'Game not found' });
		}
		
		const gameData = {
		  title: req.body.title,
		  link: req.body.link || '',
		  rageRating: parseInt(req.body.rageRating) || 0,
		  finished: req.body.finished === 'true',
		  is_checked: req.body.is_checked === 'true',
		  platform: req.body.platform || '',
		  strikes: parseInt(req.body.strikes) || 0,
		  notes: req.body.notes || '',
		  coverArtPath: existingGame.coverArtPath,
		  gameplayImagePath: existingGame.gameplayImagePath
		};
		
		// Handle folder renaming if title changed
		if (req.body.title && existingGame.title !== req.body.title) {
		  const renameResult = await renameGameFolder(existingGame.title, req.body.title);
		  if (!renameResult.success) {
			console.warn('Folder rename warning:', renameResult.message);
		  }
		  
		  // Update image paths if they exist
		  if (gameData.coverArtPath) {
			const oldFolder = sanitizeFolderName(existingGame.title);
			const newFolder = sanitizeFolderName(req.body.title);
			gameData.coverArtPath = gameData.coverArtPath.replace(
			  `/uploads/${oldFolder}/`,
			  `/uploads/${newFolder}/`
			);
		  }
		  if (gameData.gameplayImagePath) {
			const oldFolder = sanitizeFolderName(existingGame.title);
			const newFolder = sanitizeFolderName(req.body.title);
			gameData.gameplayImagePath = gameData.gameplayImagePath.replace(
			  `/uploads/${oldFolder}/`,
			  `/uploads/${newFolder}/`
			);
		  }
		}
		
		const folderName = sanitizeFolderName(gameData.title);
		
		// Handle file uploads
		if (req.files && req.files.coverArt) {
		  // Delete old file
		  if (existingGame.coverArtPath) {
			const oldPath = existingGame.coverArtPath.replace(`http://localhost:${PORT}`, getAppDataPath());
			if (fs.existsSync(oldPath)) {
			  fs.unlinkSync(oldPath);
			}
		  }
		  gameData.coverArtPath = `http://localhost:${PORT}/uploads/${folderName}/${req.files.coverArt[0].filename}`;
		}
		
		if (req.files && req.files.gameplayImage) {
		  // Delete old file
		  if (existingGame.gameplayImagePath) {
			const oldPath = existingGame.gameplayImagePath.replace(`http://localhost:${PORT}`, getAppDataPath());
			if (fs.existsSync(oldPath)) {
			  fs.unlinkSync(oldPath);
			}
		  }
		  gameData.gameplayImagePath = `http://localhost:${PORT}/uploads/${folderName}/${req.files.gameplayImage[0].filename}`;
		}
		
		await db.updateGame(gameId, gameData);
		res.json({ message: 'Game updated successfully' });
	  } catch (error) {
		console.error('Error updating game:', error);
		res.status(500).json({ error: error.message });
	  }
	});
		
    expressApp.delete('/games/delete/:id', async (req, res) => {
      try {
        const game = await db.getGameById(req.params.id);
        if (!game) {
          return res.status(404).json({ error: 'Game not found' });
        }
        
        // Delete associated files
        if (game.coverArtPath) {
          const filePath = game.coverArtPath.replace(`http://localhost:${PORT}`, getAppDataPath());
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
        
        if (game.gameplayImagePath) {
          const filePath = game.gameplayImagePath.replace(`http://localhost:${PORT}`, getAppDataPath());
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
        
        await db.deleteGame(req.params.id);
        res.json({ message: 'Game deleted successfully' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    expressApp.get('/games/export', async (req, res) => {
      try {
        const games = await db.getAllGames();
        const exportData = {
          exportDate: new Date().toISOString(),
          games: games
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="game_collection_export.json"');
        res.json(exportData);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    expressApp.post('/games/import', upload.single('file'), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const fileContent = fs.readFileSync(req.file.path, 'utf8');
        const importData = JSON.parse(fileContent);
        
        // Clear existing games
        await db.clearAllGames();
        
        let importedCount = 0;
        if (importData.games && Array.isArray(importData.games)) {
          for (const game of importData.games) {
            await db.createGame(game);
            importedCount++;
          }
        }
        
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        
        res.json({ message: `Successfully imported ${importedCount} games` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
	
		// Dodaj te endpointy w main.js po istniejących route'ach
	expressApp.get('/games/stats/checked', async (req, res) => {
	  try {
		const stmt = db.db.prepare('SELECT COUNT(*) as count FROM games WHERE is_checked == 0');
		const result = stmt.get();
		res.json({ count: result.count });
	  } catch (error) {
		console.error('Error getting checked count:', error);
		res.status(500).json({ error: error.message });
	  }
	});

	expressApp.get('/games/stats/todo', async (req, res) => {
	  try {
		const stmt = db.db.prepare('SELECT COUNT(*) as count FROM games WHERE is_checked == 1');
		const result = stmt.get();
		res.json({ count: result.count });
	  } catch (error) {
		console.error('Error getting todo count:', error);
		res.status(500).json({ error: error.message });
	  }
	});
    
    server = expressApp.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
    
  } catch (error) {
    console.error('Failed to initialize app:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.loadFile('game-collection.html');

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC handlers
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  return result;
});

// Add this with the other IPC handlers
ipcMain.handle('open-game-folder', async (event, title) => {
    try {
        const folderName = sanitizeFolderName(title);
        const uploadsPath = path.join(getAppDataPath(), 'uploads');
        const gameFolderPath = path.join(uploadsPath, folderName);
        
        // Create folder if it doesn't exist
        if (!fs.existsSync(gameFolderPath)) {
            fs.mkdirSync(gameFolderPath, { recursive: true });
        }
        
        // Open the folder in the system file explorer
        await shell.openPath(gameFolderPath);
        
        return { success: true, path: gameFolderPath };
    } catch (error) {
        console.error('Error opening game folder:', error);
        return { success: false, message: error.message };
    }
});

ipcMain.handle('save-file', async (event, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  return result;
});

ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url);
});

app.whenReady().then(() => {
  initializeApp();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (server) {
    server.close();
  }
  if (db) {
    db.close();
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (server) {
    server.close();
  }
  if (db) {
    db.close();
  }
});

function sanitizeFolderName(title) {
  return title
    .replace(/[^a-zA-Z0-9-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 50)
    .toLowerCase();
}