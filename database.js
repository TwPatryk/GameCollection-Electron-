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
      return Promise.resolve();
    } catch (error) {
      console.error('Database initialization error:', error);
      return Promise.reject(error);
    }
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
        dateAdded DATE DEFAULT CURRENT_DATE
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
				dateAdded: row.dateAdded // Ensure this is properly formatted
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
          strikes: row.strikes || 0
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
          notes, coverArtPath, gameplayImagePath, dateAdded
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE('now'))
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
        gameData.gameplayImagePath || null
      );

      return Promise.resolve(result.lastInsertRowid);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async updateGame(id, gameData) {
    try {
      const stmt = this.db.prepare(`
        UPDATE games SET 
          title = ?, link = ?, rageRating = ?, finished = ?, is_checked = ?,
          platform = ?, strikes = ?, notes = ?, 
          coverArtPath = ?, gameplayImagePath = ?
        WHERE id = ?
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