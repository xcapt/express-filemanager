var Filemanager = require('./filemanager');

module.exports = function (config, logger) {
  var fm = new Filemanager(config, logger);

  var uploader = config.connector.uploader;

  var handlers = {
    getinfo: function (req, res, next) {
      var file = req.query.path || req.body.path;
      fm.getinfo(file, function (err, result) {
        if (err) {
          next(err);
          return;
        }

        fm.log && fm.log.info('sending info for file ' + fm.getFullPath(file));
        res.json(result);
      });
    },

    getfolder: function (req, res, next) {
      var folder = req.query.path || req.body.path;
      fm.getfolder(folder, function (err, result) {
        if (err) {
          next(err);
          return;
        }

        res.json(result);
      });
    },

    editfile: function (req, res, next) {
      var file = req.query.path || req.body.path;
      fm.editfile(file, function (err, result) {
        if (err) {
          next(err);
          return;
        }

        res.json(result);
      });
    },

    savefile: function (req, res, next) {
      var file = req.query.path || req.body.path;
      var content = req.body.content;
      fm.savefile(file, content, function (err, result) {
        if (err) {
          next(err);
          return;
        }

        res.json(result);
      });
    },

    rename: function (req, res, next) {
      var file = req.query.old || req.body.old;
      var newName = req.query.new || req.body.new;
      fm.rename(file, newName, function (err, result) {
        if (err) {
          next(err);
          return;
        }

        res.json(result);
      });
    },

    move: function (req, res, next) {
      var file = req.query.old || req.body.old;
      var newDir = req.query.new || req.body.new;
      var rootDir = req.query.root || req.body.root;
      fm.move(file, newDir, rootDir, function (err, result) {
        if (err) {
          next(err);
          return;
        }

        res.json(result);
      });
    },

    delete: function (req, res, next) {
      var file = req.query.path || req.body.path;
      fm.delete(file, function (err, result) {
        if (err) {
          next(err);
          return;
        }

        res.json(result);
      });
    },

    add: function (req, res, next) {
      var dir = req.body.currentpath;
      var file = req.files.newfile[0];

      fm.add(dir, file, function (err, result) {
        if (err) {
          next(err);
          return;
        }

        res.send('<textarea>' + JSON.stringify(result) + '</textarea>');
      });
    },

    replace: function (req, res, next) {
      var oldFile = req.body.newfilepath;
      var file = req.files.fileR[0];

      fm.replace(oldFile, file, function (err, result) {
        if (err) {
          next(err);
          return;
        }

        res.send('<textarea>' + JSON.stringify(result) + '</textarea>');
      });
    },

    addfolder: function (req, res, next) {
      var parent = req.query.path || req.body.path;
      var name = req.query.name || req.body.name;

      fm.addfolder(parent, name, function (err, result) {
        if (err) {
          next(err);
          return;
        }

        res.json(result);
      });
    },

    download: function (req, res, next) {
      var file = req.query.path || req.body.path;
      fm.canDownload(file, function (err, fullPath) {
        if (err) {
          next(err);
          return;
        }

        if (fullPath != false) {
          var fs = require('fs');
          fs.stat(fullPath, function (err, stat) {
            if (err) {
              next(err);
              return;
            }

            if (stat.isFile()) {
              fm.log && fm.log.info('download file ' + fullPath);
              res.download(fullPath);
              return;
            }


            fm.log && fm.log.info('download folder ' + fullPath);
            var path = require('path');
            var dirname = path.dirname(fullPath);
            var basename = path.basename(fullPath);

            res.writeHead(200, {
              'Content-Type': 'application/zip',
              'Content-Disposition': 'attachment; filename=' + basename + '.zip'
            });

            var archiver = require('archiver');
            var archive = archiver.create('zip');

            archive.bulk([{
              expand: true,
              cwd: dirname,
              src: [basename + '/**/*']
            }]);

            archive.pipe(res);
            archive.finalize();
          });
          return;
        }

        fm.reportError('NOT_ALLOWED', function (err, result) {
          if (err) {
            next(err);
            return;
          }

          res.send('<textarea>' + JSON.stringify(result) + '</textarea>');
        });
      });
    }
  };

  function middleware(req, res, next) {
    var mode = req.query.mode || req.body.mode;
    var handler = handlers[mode];

    if (typeof handler == 'function') {
      handler(req, res, next);
      return;
    }

    fm.reportError('MODE_ERROR', function (err, msg) {
      res.json(msg);
    });
  }

  return function (req, res, next) {
    if (req.is('multipart/form-data')) {
      uploader.fields([
        {name: 'newfile'},
        {name: 'fileR'}
      ])(req, res, function (err) {
        if (err) {
          if (err.code == 'LIMIT_FILE_SIZE') {
            fm.reportError(err.message, function (err, result) {
              if (err) {
                next(err);
                return;
              }

              res.send('<textarea>' + JSON.stringify(result) + '</textarea>');
            });
            return;
          }

          next(err);
          return;
        }

        middleware(req, res, next);
      });
      return;
    }

    middleware(req, res, next);
  };
};