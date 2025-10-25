const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

class GameDatabase {
  constructor() {
    this.db = null;
  }

  // Get the application directory for portable storage
  getAppDataPath() {
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

  async initialize() {
    try {
      // Store database in the application directory instead of user data
      const dbPath = path.join(this.getAppDataPath(), 'games.db');
      
      this.db = new Database(dbPath);
      console.log('Connected to SQLite database at:', dbPath);
      
      this.createTables();
      
      // Add schema update to ensure new columns exist
      await this.updateSchema();
      
      return Promise.resolve();
    } catch (error) {
      console.error('Database initialization error:', error);
      return Promise.reject(error);
    }
  }

  async updateSchema() {
    return new Promise((resolve, reject) => {
      const columnsToAdd = [
        { name: 'additionalPhotos', type: 'TEXT' },
        { name: 'additionalNotes', type: 'TEXT' }
      ];

      let completed = 0;
      
      columnsToAdd.forEach(column => {
        try {
          // Check if column exists by trying to select it
          this.db.prepare(`SELECT ${column.name} FROM games LIMIT 1`).get();
          console.log(`Column ${column.name} already exists`);
          completed++;
          if (completed === columnsToAdd.length) resolve();
        } catch (error) {
          // Column doesn't exist, add it
          try {
            this.db.exec(`ALTER TABLE games ADD COLUMN ${column.name} ${column.type}`);
            console.log(`Added column ${column.name} to games table`);
            completed++;
            if (completed === columnsToAdd.length) resolve();
          } catch (alterError) {
            console.warn(`Could not add column ${column.name}:`, alterError.message);
            completed++;
            if (completed === columnsToAdd.length) resolve();
          }
        }
      });
      
      // Handle case where no columns need to be added
      if (columnsToAdd.length === 0) {
        resolve();
      }
    });
  }

  createTables() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        link TEXT,
        rageRating INTEGER DEFAULT 0,
        finished BOOLEAN DEFAULT FALSE,
		is_checked BOOLEAN DEFAULT FALSE,
        platform TEXT,
        strikes INTEGER DEFAULT 0,
        notes TEXT,
        coverArtPath TEXT,
        gameplayImagePath TEXT,
        dateAdded DATE DEFAULT CURRENT_DATE,
        additionalPhotos TEXT,
        additionalNotes TEXT
      )
    `;

    try {
      this.db.exec(createTableSQL);
      console.log('Games table created or already exists');
    } catch (error) {
      console.error('Error creating tables:', error);
      throw error;
    }
  }

	async getAllGames() {
		try {
			const stmt = this.db.prepare('SELECT * FROM games'); // Remove ORDER BY
			const rows = stmt.all();
			
			// Convert boolean values and ensure proper data types
			const games = rows.map(row => ({
				...row,
				finished: Boolean(row.finished),
				is_checked: Boolean(row.is_checked),
				rageRating: row.rageRating || 0,
				strikes: row.strikes || 0,
				dateAdded: row.dateAdded, // Ensure this is properly formatted
				additionalPhotos: row.additionalPhotos ? JSON.parse(row.additionalPhotos) : [],
				additionalNotes: row.additionalNotes ? JSON.parse(row.additionalNotes) : []
			}));
			
			return Promise.resolve(games);
		} catch (error) {
			return Promise.reject(error);
		}
	}

  async getGameById(id) {
    try {
      const stmt = this.db.prepare('SELECT * FROM games WHERE id = ?');
      const row = stmt.get(id);
      
      if (row) {
        // Convert boolean values and ensure proper data types
        const game = {
          ...row,
          finished: Boolean(row.finished),
		  is_checked: Boolean(row.is_checked),
          rageRating: row.rageRating || 0,
          strikes: row.strikes || 0,
          additionalPhotos: row.additionalPhotos ? JSON.parse(row.additionalPhotos) : [],
          additionalNotes: row.additionalNotes ? JSON.parse(row.additionalNotes) : []
        };
        return Promise.resolve(game);
      } else {
        return Promise.resolve(null);
      }
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async createGame(gameData) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO games (
          title, link, rageRating, finished, is_checked, platform, strikes, 
          notes, coverArtPath, gameplayImagePath, dateAdded, additionalPhotos, additionalNotes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE('now'), ?, ?)
      `);

      const result = stmt.run(
        gameData.title,
        gameData.link || '',
        gameData.rageRating || 0,
        gameData.finished ? 1 : 0,
		gameData.is_checked ? 1 : 0,
        gameData.platform || '',
        gameData.strikes || 0,
        gameData.notes || '',
        gameData.coverArtPath || null,
        gameData.gameplayImagePath || null,
        gameData.additionalPhotos ? JSON.stringify(gameData.additionalPhotos) : '[]',
        gameData.additionalNotes ? JSON.stringify(gameData.additionalNotes) : '[]'
      );

      return Promise.resolve(result.lastInsertRowid);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async updateGame(id, gameData) {
    try {
      // Get the existing game to preserve fields that aren't being updated
      const existingGame = await this.getGameById(id);
      if (!existingGame) {
        throw new Error('Game not found');
      }

      // Merge existing data with new data, preserving fields that aren't provided
      const mergedData = {
        title: gameData.title !== undefined ? gameData.title : existingGame.title,
        link: gameData.link !== undefined ? gameData.link : existingGame.link,
        rageRating: gameData.rageRating !== undefined ? gameData.rageRating : existingGame.rageRating,
        finished: gameData.finished !== undefined ? gameData.finished : existingGame.finished,
        is_checked: gameData.is_checked !== undefined ? gameData.is_checked : existingGame.is_checked,
        platform: gameData.platform !== undefined ? gameData.platform : existingGame.platform,
        strikes: gameData.strikes !== undefined ? gameData.strikes : existingGame.strikes,
        notes: gameData.notes !== undefined ? gameData.notes : existingGame.notes,
        coverArtPath: gameData.coverArtPath !== undefined ? gameData.coverArtPath : existingGame.coverArtPath,
        gameplayImagePath: gameData.gameplayImagePath !== undefined ? gameData.gameplayImagePath : existingGame.gameplayImagePath,
        additionalPhotos: gameData.additionalPhotos !== undefined ? gameData.additionalPhotos : existingGame.additionalPhotos,
        additionalNotes: gameData.additionalNotes !== undefined ? gameData.additionalNotes : existingGame.additionalNotes
      };

      const stmt = this.db.prepare(`
        UPDATE games SET 
          title = ?, link = ?, rageRating = ?, finished = ?, is_checked = ?,
          platform = ?, strikes = ?, notes = ?, 
          coverArtPath = ?, gameplayImagePath = ?,
          additionalPhotos = ?, additionalNotes = ?
        WHERE id = ?
      `);

      const result = stmt.run(
        mergedData.title,
        mergedData.link || '',
        mergedData.rageRating || 0,
        mergedData.finished ? 1 : 0,
        mergedData.is_checked ? 1 : 0,
        mergedData.platform || '',
        mergedData.strikes || 0,
        mergedData.notes || '',
        mergedData.coverArtPath || null,
        mergedData.gameplayImagePath || null,
        mergedData.additionalPhotos ? JSON.stringify(mergedData.additionalPhotos) : '[]',
        mergedData.additionalNotes ? JSON.stringify(mergedData.additionalNotes) : '[]',
        id
      );

      return Promise.resolve(result.changes);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async deleteGame(id) {
    try {
      const stmt = this.db.prepare('DELETE FROM games WHERE id = ?');
      const result = stmt.run(id);
      return Promise.resolve(result.changes);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async clearAllGames() {
    try {
      const stmt = this.db.prepare('DELETE FROM games');
      const result = stmt.run();
      return Promise.resolve(result.changes);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
        console.log('Database connection closed');
      } catch (error) {
        console.error('Error closing database:', error);
      }
    }
  }
}

module.exports = GameDatabase;