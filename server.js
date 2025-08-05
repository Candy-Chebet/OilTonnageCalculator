const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files


// Database connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'oil_calculator',
  port: process.env.DB_PORT || 5432,
  max: 10, // connectionLimit
  idleTimeoutMillis: 60000, // timeout
  connectionTimeoutMillis: 60000 // acquireTimeout
});

// Test database connection
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('Database connected successfully');
    client.release();
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
}

// Initialize database tables
async function initializeDatabase() {
  let client;
  try {
    client = await pool.connect();
    
    // Create oil_tonnages table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS oil_tonnages (
        id SERIAL PRIMARY KEY,
        volume DECIMAL(15,2) NOT NULL,
        density DECIMAL(8,2) NOT NULL,
        temperature DECIMAL(6,2) NOT NULL,
        vcf DECIMAL(10,6) NOT NULL,
        used_density DECIMAL(8,2) NOT NULL,
        used_temperature DECIMAL(6,2) NOT NULL,
        tonnage DECIMAL(15,8) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create indexes separately
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tonnage_created_at ON oil_tonnages(created_at)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tonnage_density_temp ON oil_tonnages(density, temperature)
    `);
    
    console.log('Database tables initialized');
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  } finally {
    if (client) client.release();
  }
}

// Helper function to round to nearest step
function roundToNearest(value, step) {
  return Math.round(value / step) * step;
}

// Get VCF from database
async function getVCFFromDatabase(density, temperature) {
  let client;
  try {
    const roundedDensity = roundToNearest(density, 0.5);
    const roundedTemp = roundToNearest(temperature, 0.25);
    
    client = await pool.connect();
    
    // First try to get exact match
    const exactMatch = await client.query(
      'SELECT vcf FROM vcftable WHERE density = $1 AND temperature = $2 LIMIT 1',
      [roundedDensity, roundedTemp]
    );
    
    if (exactMatch.rows.length > 0) {
      return {
        vcf: parseFloat(exactMatch.rows[0].vcf),
        usedDensity: roundedDensity,
        usedTemp: roundedTemp
      };
    }
    
    // If no exact match, find closest values
    const closestDensityQuery = await client.query(
      'SELECT density FROM vcftable ORDER BY ABS(density - $1) LIMIT 1',
      [roundedDensity]
    );
    
    const closestDensity = closestDensityQuery.rows[0]?.density || roundedDensity;
    
    const closestTempQuery = await client.query(
      'SELECT vcf, temperature FROM vcftable WHERE density = $1 ORDER BY ABS(temperature - $2) LIMIT 1',
      [closestDensity, roundedTemp]
    );
    
    if (closestTempQuery.rows.length > 0) {
      return {
        vcf: parseFloat(closestTempQuery.rows[0].vcf),
        usedDensity: closestDensity,
        usedTemp: closestTempQuery.rows[0].temperature
      };
    }
    
    // Fallback if no data found
    throw new Error('VCF data not found for given parameters');
    
  } catch (error) {
    console.error('Error getting VCF from database:', error);
    throw error;
  } finally {
    if (client) client.release();
  }
}

// Validation middleware (unchanged)
function validateCalculationInput(req, res, next) {
  const { volume, density, temperature } = req.body;
  const errors = [];
  
  if (!volume || isNaN(volume) || volume <= 0) {
    errors.push('Volume must be a positive number');
  }
  
  if (!density || isNaN(density) || density < 700 || density > 1000) {
    errors.push('Density must be between 700-1000 kg/m³');
  }
  
  if (temperature === undefined || temperature === null || isNaN(temperature) || temperature < -20 || temperature > 60) {
    errors.push('Temperature must be between -20°C and 60°C');
  }
  
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }
  
  next();
}

// API Routes

// Calculate tonnage
app.post('/api/calculate', validateCalculationInput, async (req, res) => {
  let client;
  try {
    const { volume, density, temperature } = req.body;
    
    // Get VCF from database
    const vcfData = await getVCFFromDatabase(density, temperature);
    
    // Calculate tonnage: (Volume * Density * VCF) / 1,000,000
    const tonnage = (volume * density * vcfData.vcf) / 1000000;
    
    // Store calculation in database
    client = await pool.connect();
    const result = await client.query(
      `INSERT INTO oil_tonnages 
       (volume, density, temperature, vcf, used_density, used_temperature, tonnage) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
      [volume, density, temperature, vcfData.vcf, vcfData.usedDensity, vcfData.usedTemp, tonnage]
    );
    
    res.json({
      success: true,
      data: {
        id: result.rows[0].id,
        volume,
        density,
        temperature,
        vcf: vcfData.vcf,
        usedDensity: vcfData.usedDensity,
        usedTemp: vcfData.usedTemp,
        tonnage,
        timestamp: result.rows[0].created_at.toISOString()
      }
    });
    
  } catch (error) {
    console.error('Calculation error:', error);
    res.status(500).json({ 
      error: 'Failed to calculate tonnage', 
      message: error.message 
    });
  } finally {
    if (client) client.release();
  }
});

// Get calculation history
app.get('/api/calculations', async (req, res) => {
  let client;
  try {
    console.log('=== GET /api/calculations DEBUG START ===');
    console.log('Query params:', req.query);
    
    const { page = 1, limit = 50, search = '', sort = 'created_at', order = 'DESC' } = req.query;
    const offset = (page - 1) * limit;
    
    console.log('Parsed params:', { page, limit, search, sort, order, offset });
    
    let whereClause = '';
    let queryParams = [];
    
    if (search) {
      whereClause = `WHERE 
        volume::text LIKE $1 OR 
        density::text LIKE $2 OR 
        temperature::text LIKE $3 OR 
        tonnage::text LIKE $4 OR 
        to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') LIKE $5`;
      const searchPattern = `%${search}%`;
      queryParams = Array(5).fill(searchPattern);
      console.log('Search WHERE clause:', whereClause);
      console.log('Search params:', queryParams);
    }
    
    const validSortColumns = ['created_at', 'volume', 'density', 'temperature', 'tonnage'];
    const sortColumn = validSortColumns.includes(sort) ? sort : 'created_at';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    
    console.log('Final sort:', { sortColumn, sortOrder });
    
    // Test database connection first
    console.log('Attempting to connect to database...');
    client = await pool.connect();
    console.log('Database connection successful');
    
    // Test basic query first
    console.log('Testing basic database query...');
    const testQuery = await client.query('SELECT NOW() as current_time');
    console.log('Basic query result:', testQuery.rows[0]);
    
    // Check if oil_tonnages table exists
    console.log('Checking if oil_tonnages table exists...');
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'oil_tonnages'
      );
    `);
    console.log('Table exists:', tableExists.rows[0].exists);
    
    if (!tableExists.rows[0].exists) {
      throw new Error('oil_tonnages table does not exist');
    }
    
    // Get table structure
    console.log('Getting table structure...');
    const tableStructure = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'oil_tonnages' 
      ORDER BY ordinal_position;
    `);
    console.log('Table structure:', tableStructure.rows);
    
    // Get total count
    console.log('Getting total count...');
    const countQuery = whereClause 
      ? `SELECT COUNT(*) as total FROM oil_tonnages ${whereClause}`
      : 'SELECT COUNT(*) as total FROM oil_tonnages';
    
    console.log('Count query:', countQuery);
    console.log('Count params:', queryParams);
    
    const countResult = await client.query(countQuery, queryParams);
    console.log('Total count result:', countResult.rows[0]);
    
    // Get paginated results
    console.log('Getting paginated results...');
    const query = `
      SELECT 
        id, volume, density, temperature, vcf, used_density, used_temperature, 
        tonnage, created_at 
      FROM oil_tonnages 
      ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder}
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    
    console.log('Main query:', query);
    console.log('Main query params:', [...queryParams, parseInt(limit), parseInt(offset)]);
    
    const calculations = await client.query(
      query,
      [...queryParams, parseInt(limit), parseInt(offset)]
    );
    
    console.log('Query executed successfully');
    console.log('Number of rows returned:', calculations.rows.length);
    console.log('Sample row (if any):', calculations.rows[0]);
    
    const response = {
      success: true,
      data: calculations.rows.map(row => ({
        ...row,
        timestamp: row.created_at.toISOString()
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    };
    
    console.log('Response prepared:', {
      dataCount: response.data.length,
      pagination: response.pagination
    });
    console.log('=== GET /api/calculations DEBUG END ===');
    
    res.json(response);
    
  } catch (error) {
    console.error('=== ERROR in /api/calculations ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    console.error('=== END ERROR ===');
    
    res.status(500).json({ 
      error: 'Failed to fetch calculations',
      message: error.message,
      code: error.code || 'UNKNOWN_ERROR'
    });
  } finally {
    if (client) {
      console.log('Releasing database connection');
      client.release();
    }
  }
});


// Delete calculation
app.delete('/api/calculations/:id', async (req, res) => {
  let client;
  try {
    const { id } = req.params;
    
    client = await pool.connect();
    const result = await client.query(
      'DELETE FROM oil_tonnages WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Calculation not found' });
    }
    
    res.json({ success: true, message: 'Calculation deleted successfully' });
    
  } catch (error) {
    console.error('Error deleting calculation:', error);
    res.status(500).json({ 
      error: 'Failed to delete calculation',
      message: error.message 
    });
  } finally {
    if (client) client.release();
  }
});

// Clear all calculations
app.delete('/api/calculations', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('DELETE FROM oil_tonnages');
    res.json({ success: true, message: 'All calculations cleared successfully' });
  } catch (error) {
    console.error('Error clearing calculations:', error);
    res.status(500).json({ 
      error: 'Failed to clear calculations',
      message: error.message 
    });
  } finally {
    if (client) client.release();
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');
    res.json({ 
      success: true, 
      message: 'Server and database are healthy',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Database connection failed',
      error: error.message 
    });
  } finally {
    if (client) client.release();
  }
});

// Serve the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Initialize and start server
async function startServer() {
  await testConnection();
  await initializeDatabase();
  
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Frontend available at: http://localhost:${port}`);
    console.log(`API available at: http://localhost:${port}/api`);
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

startServer().catch(console.error);