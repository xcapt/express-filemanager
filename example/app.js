var fs = require('fs');
var express = require('express');
var bodyParser = require('body-parser');
var multer = require('multer');
var filemanager = require('..');
var util = require('util');

var app = express();

// body-parser is required of course
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// read Filemanager config
// config is shared between server and client parts
var config = JSON.parse(
  fs.readFileSync('public/Filemanager/scripts/filemanager.config.js')
);

// additional connector-specific options
config.connector = {

  // set path to web-server root
  serverRoot: './public',

  // path to Filemanager sources under server root
  fmSrcPath: '/Filemanager',

  // uploader should be a preconfigured instance of multer
  uploader: multer({ dest: 'uploads' })
};

// set Filemanager file root outside server root
// serverRoot is set to false in the config file
config.options.fileRoot = require('path').join(__dirname, 'data/');

// simplest logger with timestamps
var logger = {
  debug: util.log,
  info: util.log,
  error: util.log
};

// filemanager returns express middleware function
// that handle all Filemanager requests
var fm = filemanager(config, logger);
app.use('/fm', fm);
// You can use express middleware mechanism to authenticate requests
// before they come to Filemanager

// serve static files
app.use(express.static('public'));

var port = 3000;
logger.info('launching server on port '+port);
app.listen(port);