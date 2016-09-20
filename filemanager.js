'use strict';

var fs = require('fs');
var path = require('path');
var async = require('async');
var indexBy = require('lodash.indexby');
var dateutil = require('dateutil');
var util = require('util');
var rimraf = require('rimraf');
var htmlEntries = new (require('html-entities').AllHtmlEntities)();
var fsAccess = require('./lib/fs-access');

module.exports = Filemanager;

function Filemanager(config, logger) {
  var fm = this;
  fm.config = config;
  fm.log = logger;

  fm.fmSrcPath = fm.config.connector.fmSrcPath;
  fm.serverRoot = fm.config.connector.serverRoot;

  // Configure Filemanager paths according to PHP version
  if (fm.config.options.fileRoot === false) {
    fm.root = path.join(fm.serverRoot, fm.fmSrcPath, 'userfiles');
  } else {
    if (fm.config.options.serverRoot) {
      fm.root = path.resolve(fm.serverRoot, fm.config.connector.fileRoot);
    } else {
      fm.root = path.normalize(fm.config.options.fileRoot);
    }
  }

  logger.debug('filemanager root set to: '+fm.root+' => '+path.resolve(fm.root));

  // Load languages
  var langFile = (fm.config.options.culture || 'en') + '.js';
  langFile = path.join(fm.serverRoot, fm.fmSrcPath, 'scripts/languages', langFile);
  fm.language = JSON.parse(fs.readFileSync(langFile));

  // Load permissions
  fm.allowedActions = fm.config.options.capabilities;
  if (fm.config.edit.enabled) fm.allowedActions.push('edit');

  // Load list of available file icons
  var fileIcons = fm.fileIcons = {};
  fs.readdirSync(path.join(fm.serverRoot, fm.fmSrcPath, 'images/fileicons'))
    .forEach(function (icon) {
      fileIcons[icon.slice(0, -4)] =
        path.join(fm.fmSrcPath, 'images/fileicons', icon).replace(/\\/g, '/');
    });
}

var proto = Filemanager.prototype;

proto.getinfo = function (file, cb) {
  var fm = this;
  var fullPath = this.getFullPath(file);
  var baseName = path.basename(file);
  var fileType = path.extname(baseName).slice(1).toLowerCase();

  function reportResult(result) {
    cb(null, {
      'Path': file,
      'Filename': baseName,
      'File Type': fileType,
      'Protected': result && result.protected || 0,
      'Preview': result && result.preview || fm.config.icons.path + fm.config.icons.default,
      'Properties': result && result.properties || {},
      'Error': '',
      'Code': 0
    });
  }

  fs.stat(fullPath, function (err, stat) {
    if (err) {
      reportResult(null);
      return;
    }

    fsAccess(fullPath, fsAccess.R_OK | fsAccess.W_OK, function (err) {
      if (err) {
        reportResult({
          protected: 1,
          preview: fm.config.icons.path + 'locked_' + fm.config.icons.default
        });
        return;
      }

      var result = {};
      var props = result.properties = {};

      if (stat.isDirectory()) {
        fileType = 'dir';
        result.preview = fm.config.icons.path + fm.config.icons.directory;

        if (file[file.length - 1] != '/') {
          file = file + '/';
        }
      }

      if (stat.isFile()) {
        props['Size'] = stat.size;
        var icon = fm.fileIcons[fileType];
        if (icon) result.preview = icon;
      }

      var dateFormat = fm.config.options.dateFormat;

      props['Date Modified'] = dateutil.format(stat.mtime, dateFormat);
      props['Date Created'] = dateutil.format(stat.birthtime, dateFormat);

      reportResult(result);
    });
  });
};

proto.getfolder = function (folder, cb) {
  var fm = this;
  var fullPath = this.getFullPath(folder);

  fs.stat(fullPath, function (err, stat) {
    if (err || !stat.isDirectory()) {
      fm.reportError('DIRECTORY_NOT_EXIST', [folder], cb);
      return;
    }

    fsAccess(fullPath, fsAccess.R_OK, function (err) {
      if (err) {
        fm.reportError('NOT_ALLOWED_SYSTEM', cb);
        return;
      }

      fs.readdir(fullPath, function (err, files) {
        if (err) {
          fm.reportError('UNABLE_TO_OPEN_DIRECTORY', [folder], cb);
          return;
        }

        async.map(files,
          function (file, done) {
            fm.getinfo(path.join(folder, file).replace(/\\/g, '/'), done);
          },
          function (err, results) {
            results.filter(function (r) {
              var p = r['Path'];
              var itsDir = r['File Type'] == 'dir';
              return itsDir && fm.config.exclude.unallowed_dirs[p]
                || !itsDir && fm.config.exclude.unallowed_files[p];
            });

            if(fm.log) {
              fm.log.debug('sending info for folder ' + fullPath+' => '+path.resolve(fullPath));
            }

            cb(err, indexBy(results, 'Path'));
          });
      });
    });
  });
};

proto.editfile = function (file, cb) {
  var fm = this;
  var fullPath = this.getFullPath(file);

  fsAccess(fullPath, fsAccess.R_OK | fsAccess.W_OK, function (err) {
    if (err) {
      fm.reportError('NOT_ALLOWED_SYSTEM', cb);
      return;
    }

    if (!fm.hasPermission('edit')) {
      fm.reportError('No way.', cb);
      return;
    }

    fs.readFile(fullPath, function (err, content) {
      if (err) {
        fm.reportError('ERROR_OPENING_FILE', [file], cb);
        return;
      }

      content = escapeHtml(content.toString());

      fm.log && fm.log.debug('editing file ' + fullPath);

      cb(null, {
        'Error': '',
        'Code': 0,
        'Path': file,
        'Content': content
      });
    });
  });
};

proto.savefile = function (file, content, cb) {
  var fm = this;
  var fullPath = this.getFullPath(file);

  if (typeof content != 'string') {
    fm.reportError('File content missing.', cb);
  }

  fsAccess(fullPath, fsAccess.W_OK, function (err) {
    if (err) {
      fm.reportError('ERROR_WRITING_PERM', [file], cb);
      return;
    }

    if (!fm.hasPermission('edit')) {
      fm.reportError('No way.', cb);
      return;
    }

    content = unescapeHtml(content);
    fs.writeFile(fullPath, content, function (err) {
      if (err) {
        fm.reportError('ERROR_SAVING_FILE', [file], cb);
        return;
      }

      fm.log && fm.log.debug('saving file ' + fullPath);

      cb(null, {
        'Error': '',
        'Code': 0,
        'Path': file
      });
    });
  });
};

proto.rename = function (file, newName, cb) {
  var fm = this;

  var oldFile = fm.getFullPath(file);
  var dir = path.dirname(oldFile);
  var newFile = path.join(dir, newName);

  if (fm.isRootDir(dir)) {
    fm.reportError('NOT_ALLOWED', cb);
    return;
  }

  if (!fm.hasPermission('rename')) {
    fm.reportError('No way.', cb);
    return;
  }

  fs.stat(oldFile, function (err, stat) {
    if (err) {
      fm.reportError('File does not exist.', cb);
      return;
    }

    if (stat.isFile()) {
      if (fm.config.security.allowChangeExtensions && !fm.isFileTypeAllowed(newName)) {
        fm.reportError('INVALID_FILE_TYPE', cb);
        return;
      }

      fsAccess(oldFile, fsAccess.W_OK, function (err) {
        if (err) {
          fm.reportError('NOT_ALLOWED_SYSTEM', cb);
          return;
        }

        fsAccess(newFile, function (err) {
          if (!err) {
            var msg = stat.isFile() ? 'FILE_ALREADY_EXISTS' : 'DIRECTORY_ALREADY_EXISTS';
            fm.reportError(msg, [newName], cb);
            return;
          }

          fs.rename(oldFile, newFile, function (err) {
            if (err) {
              var msg = stat.isFile() ? 'ERROR_RENAMING_FILE' : 'ERROR_RENAMING_DIRECTORY';
              fm.reportError(msg, [newName], cb);
              return;
            }

            fm.log && fm.log.debug('file ' + oldFile + ' renamed to ' + newFile);

            cb(null, {
              'Error': '',
              'Code': 0,
              'Old Path': file,
              'Old Name': path.basename(file),
              'New Path': path.join(path.dirname(file), newName).replace(/\\/g, '/'),
              'New Name': newName
            });
          });
        });
      });
    }
  });

};

proto.move = function (file, newDir, rootDir, cb) {
  var fm = this;

  var oldFile = fm.getFullPath(file);

  if (fm.isRootDir(file)) {
    fm.reportError('NOT_ALLOWED', cb);
    return;
  }

  if (!fm.hasPermission('move')) {
    fm.reportError('No way.', cb);
    return;
  }

  rootDir = rootDir ? rootDir.replace(/\/\//g, '/') : '';

  var oldPath = (path.dirname(file) + '/').replace(/\\/g, '/');
  var newPath = (newDir.indexOf('/') == 0)
    ? path.join(rootDir, newDir + '/').replace(/\\/g, '/')
    : path.join(oldPath, newDir + '/').replace(/\\/g, '/');

  var fileName = path.basename(file);
  var newFile = path.join(fm.getFullPath(newPath), fileName);

  fsAccess(oldFile, fsAccess.W_OK, function (err) {
    if (err) {
      fm.reportError('NOT_ALLOWED_SYSTEM', cb);
      return;
    }

    fs.stat(newFile, function (err, stat) {
      if (!err) {
        var msg = stat.isFile() ? 'FILE_ALREADY_EXISTS' : 'DIRECTORY_ALREADY_EXISTS';
        fm.reportError(msg, [newPath + fileName], cb);
        return;
      }

      fs.stat(fm.getFullPath(newPath), function (err, stat) {
        if (err) {
          fs.mkdir(newPath, parseInt('755', 8), function (err) {
            if (err) {
              fm.reportError('UNABLE_TO_CREATE_DIRECTORY', cb);
              return;
            }
            move();
          });
          return;
        }

        if (stat.isFile()) {
          fm.reportError('FILE_ALREADY_EXISTS', [newPath], cb);
          return;
        }

        move();
      });

      function move() {
        fs.rename(oldFile, newFile, function (err) {
          if (err) {
            var msg = stat.isFile() ? 'ERROR_RENAMING_FILE' : 'ERROR_RENAMING_DIRECTORY';
            fm.reportError(msg, [file], cb);
            return;
          }

          if(fm.log) {fm.log.debug('file ' + oldFile + ' moved to ' + newFile);}

          cb(null, {
            'Error': '',
            'Code': 0,
            'Old Path': oldPath + fileName,
            'Old Name': fileName,
            'New Path': newPath + fileName,
            'New Name': fileName
          });
        });
      }
    });
  });

};

proto.delete = function (file, cb) {
  var fm = this;

  if (!fm.hasPermission('delete')) {
    fm.reportError('No way.', cb);
    return;
  }

  if (fm.isRootDir(file)) {
    fm.reportError('NOT_ALLOWED', cb);
    return;
  }

  var fullPath = fm.getFullPath(file);

  fsAccess(fullPath, fsAccess.W_OK, function (err) {
    if (err) {
      fm.reportError('NOT_ALLOWED_SYSTEM', cb);
      return;
    }

    if(fm.log) {fm.log.debug('delete ' + fullPath);}

    rimraf(fullPath, function () {
      cb(null, {
        'Error': '',
        'Code': 0,
        'Path': file
      });
    });
  });
};

proto.add = function (dir, file, cb) {
  var fm = this;

  var name = file.originalname;
  var uploadedFile = file.path;
  var dest = fm.getFullPath(dir);
  var newFile = path.join(dest, name);

  var fileSizeLimit = Number(fm.config.upload.fileSizeLimit);
  if (file.size > fileSizeLimit * 1024 * 1024) {
    fm.reportError('UPLOAD_FILES_SMALLER_THAN', [fileSizeLimit + fm.langStr('mb')], cb);
    return;
  }

  if (!fm.isFileTypeAllowed(name)) {
    fm.reportError('INVALID_FILE_TYPE', cb);
    return;
  }

  if (!fm.config.upload.overwrite) {
    fsAccess(newFile, function (err) {
      if (err) {
        add();
        return;
      }

      name = fm.dupName(name);
      newFile = path.join(dest, name);
      add();
    });
    return;
  }

  add();

  function add() {
    fs.rename(uploadedFile, newFile, function (err) {
      if (err) {
        fm.reportError('ERROR_RENAMING_FILE', [name], cb);
        return;
      }

      if(fm.log) {fm.log.debug('upload file ' + newFile);}

      fs.chmod(newFile, parseInt('644', 8), function () {
        cb(null, {
          'Error': '',
          'Code': 0,
          'Path': dir,
          'Name': name
        });
      });
    });
  }
};

proto.replace = function (oldFile, file, cb) {
  var fm = this;

  var name = file.originalname;
  var uploadedFile = file.path;
  var dest = fm.getFullPath(path.dirname(oldFile));
  var newFile = path.join(dest, name);
  var replacedFile = fm.getFullPath(oldFile);

  var fileSizeLimit = Number(fm.config.upload.fileSizeLimit);
  if (file.size > fileSizeLimit * 1024 * 1024) {
    fm.reportError('UPLOAD_FILES_SMALLER_THAN', [fileSizeLimit + fm.langStr('mb')], cb);
    return;
  }

  var origExt = path.extname(oldFile);
  var newExt = path.extname(name);
  if (origExt !== newExt) {
    fm.reportError('ERROR_REPLACING_FILE', [newExt], cb);
    return;
  }

  if (!fm.isFileTypeAllowed(name)) {
    fm.reportError('INVALID_FILE_TYPE', cb);
    return;
  }

  if (!fm.hasPermission('replace')) {
    fm.reportError('No way.', cb);
    return;
  }

  fs.unlink(replacedFile, function (err) {
    if (err) {
      fm.reportError('ERROR_REPLACING_FILE', cb);
      return;
    }

    fs.rename(uploadedFile, newFile, function (err) {
      if (err) {
        fm.reportError('ERROR_RENAMING_FILE', [name], cb);
        return;
      }

      if(fm.log) {fm.log.debug('file ' + replacedFile + ' replaced with ' + newFile);}

      fs.chmod(newFile, parseInt('644', 8), function () {
        cb(null, {
          'Error': '',
          'Code': 0,
          'Path': path.dirname(oldFile).replace(/\\+/g, '/'),
          'Name': path.basename(oldFile)
        });
      });
    });
  });

};

proto.addfolder = function (parent, name, cb) {
  var fm = this;
  var newFolder = fm.getFullPath(path.join(parent, name));

  fs.stat(newFolder, function (err, stat) {
    if (!err) {
      var msg = stat.isDirectory() ? 'DIRECTORY_ALREADY_EXISTS' : 'FILE_ALREADY_EXISTS';
      fm.reportError(msg, cb);
      return;
    }

    fs.mkdir(newFolder, parseInt('755', 8), function (err) {
      if (err) {
        fm.reportError('UNABLE_TO_CREATE_DIRECTORY', cb);
        return;
      }

      if(fm.log) {fm.log.debug('create folder ' + newFolder)};

      cb(null, {
        'Error': '',
        'Code': 0,
        'Parent': parent,
        'Name': name
      });
    });
  });
};

proto.canDownload = function (file, cb) {
  var fm = this;

  var fullPath = fm.getFullPath(file);

  if (!fm.hasPermission('download')) {
    cb(null, false);
    return;
  }

  fsAccess(fullPath, fsAccess.R_OK, function (err) {
    cb(null, err ? false : fullPath);
  });
};


proto.getFullPath = function (p) {
  return path.join(this.root, p);
};

proto.reportError = function (msg, params, cb) {
  var fm = this;

  if (typeof params === 'function') {
    cb = params;
    params = undefined;
  }

  msg = this.langStr(msg);

  if (Array.isArray(params)) {
    msg = util.format.apply(this, [msg].concat(params));
  }

  fm.log && fm.log.error('sending error: "' + msg + '"');

  cb(null, {
    'Error': msg,
    'Code': -1
  });
};

proto.langStr = function (msg) {
  return this.language[msg] || msg;
};

proto.hasPermission = function (action) {
  return this.allowedActions.indexOf(action) != -1;
};

proto.isFileTypeAllowed = function (name) {
  var fm = this;

  var ext = path.extname(name).slice(1);

  if (!ext) {
    return Boolean(fm.config.security.allowNoExtension);
  }

  var policy = fm.config.security.uploadPolicy;

  if (policy === 'DISALLOW_ALL') {
    return fm.config.security.uploadRestrictions.some(function (e) {
      return e.toLowerCase() === ext.toLowerCase();
    });
  }

  if (policy === 'ALLOW_ALL') {
    return !fm.config.security.uploadRestrictions.some(function (e) {
      return e.toLowerCase() === ext.toLowerCase();
    });
  }

  return true;
};

proto.isRootDir = function (dir) {
  var fm = this;
  return path.normalize(fm.root) === path.normalize(dir);
};

proto.dupName = function (name) {
  var ext = path.extname(name);
  var base = path.basename(name, ext);

  var m = base.match(/(.+)-([1-9][0-9]*)$/);
  if (m) {
    name = m[1] + '-' + Number(m[2]) + 1 + ext;
  } else {
    name = base + '-' + 1 + ext;
  }

  return name;
};

function escapeHtml(content) {
  return htmlEntries.encode(content);
}

function unescapeHtml(content) {
  return htmlEntries.decode(content);
}