const { Client } = require('pg');
require('dotenv').config();

async function setupDatabase() {
  let client;
  
  try {
    console.log('Connecting to database...');
    
    // Create connection
    client = new Client({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'oil_calculator',
      port: process.env.DB_PORT || 5432
    });
    
    await client.connect();
    console.log('Connected to database successfully');
    
    // Create oil_tonnages table
    console.log('Creating oil_tonnages table...');
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
    
    // Create indexes separately (PostgreSQL convention)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tonnage_created_at ON oil_tonnages(created_at)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tonnage_density_temp ON oil_tonnages(density, temperature)
    `);
    
    console.log('oil_tonnages table created successfully');
    
    // Check if VCF table exists
    console.log('Checking for VCF table...');
    const tables = await client.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'vcftable'
    `);
    
    if (tables.rows[0].count === '0') {
      console.log('WARNING: VCF table (vcftable) not found!');
      console.log('Please import your vcftable.sql file:');
      console.log(`psql -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -h ${process.env.DB_HOST} -f vcftable.sql`);
    } else {
      // Check VCF table structure
      const columns = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'vcftable'
      `);
      
      const requiredColumns = ['density', 'temperature', 'vcf'];
      const existingColumns = columns.rows.map(row => row.column_name);
      
      const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
      
      if (missingColumns.length > 0) {
        console.log('WARNING: VCF table is missing required columns:', missingColumns);
      } else {
        const countResult = await client.query('SELECT COUNT(*) as count FROM vcftable');
        console.log(`VCF table found with ${countResult.rows[0].count} records`);
      }
    }
    
    console.log('Database setup completed successfully!');
    
  } catch (error) {
    console.error('Database setup failed:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.end();
    }
  }
}

setupDatabase();
