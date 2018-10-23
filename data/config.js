
var mysql= require("mysql");

cons config = {
  host: 'localhost',
  user: 'demo',
  password: 'secretPassword',
  database: 'demo'
};

const pool = mysql.createPool(config);

module.exports = pool;
