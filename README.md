# STEPS
Backend Framework of choice - NODE JS

For the purpose of the interview, functions are hardcorded into the routes inside server.js.
In a proper situation I would separate the functions into a controller module for better layering of the application & to make reusablity of the code possible.

## Step 1: Npm Init to initialize
## Step 2: Paste the following into your package.json the npm install to install all dependencies: 
{
  "name": "edible-oil-tonnage-calculator",
  "version": "1.0.0",
  "description": "Production-ready web application for calculating edible oil tonnage using VCF tables",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "jest",
    "lint": "eslint .",
    "setup-db": "node scripts/database.js"
  },
  "keywords": [
    "oil",
    "tonnage",
    "calculator",
    "vcf",
    "volume-correction-factor"
  ],
  "author": "Your Name",
  "license": "MIT",
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.5",
    "helmet": "^7.1.0",
    "joi": "^17.11.0",
    "pg": "^8.16.3",
    "pg-hstore": "^2.3.4",
    "sequelize": "^6.37.7"
  },
  "devDependencies": {
    "eslint": "^8.55.0",
    "jest": "^29.7.0",
    "nodemon": "^3.0.2",
    "supertest": "^6.3.3"
  },
  "engines": {
    "node": ">=16.0.0",
    "npm": ">=8.0.0"
  }
}

## Step 3: in your terminal run nodemon server.js to start the server

Database of choice was PostgreSQL locally setup so you can adapt it to your local environment. 

## Environment variables required: 
### Server Configuration
PORT=3000
NODE_ENV=production

### Database Configuration
DB_HOST= your local db host name
DB_USER= your db user name
DB_PASSWORD=your db password
DB_NAME= your db name in this case - oil_calculator

### Rate Limiting (requests per minute)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100


## This shows calculation results
<img width="1920" height="1647" alt="screencapture-localhost-3000-2025-08-05-17_08_20" src="https://github.com/user-attachments/assets/b0d3dfe2-681e-43f2-9328-e30ab1ab6549" />

## This shows retrieved history 
<img width="934" height="368" alt="history" src="https://github.com/user-attachments/assets/68aff2fb-3558-4cdc-b706-d3489e001c42" />

## This shows the prompt when trying to delete a calculation history
<img width="938" height="398" alt="delete step 1" src="https://github.com/user-attachments/assets/0936b3bf-279b-4875-9835-42e5154cd6eb" />

## This shows successful deletion of a calculation with 2500 volume
<img width="902" height="368" alt="delete success" src="https://github.com/user-attachments/assets/b298a326-d959-4bd9-8896-af12a768aa22" />

## This shows history cleared successfully
<img width="940" height="391" alt="clear history" src="https://github.com/user-attachments/assets/56bc1973-7901-49c0-8b7c-73d79972c17c" />


