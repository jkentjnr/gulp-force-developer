/*
 * gulp-force-developer
 * https://github.com/jkentjnr/gulp-force-developer
 *
 * Copyright (c) 2015 James Kent
 * Licensed under the MIT license.
 */

'use strict';

const gulpPluginName = 'gulp-force-developer';

var gulp = require('gulp'),
	crypto = require('crypto'),
	fs = require('fs-extra'),
    path = require('path'),
    archiver = require('archiver'),
    //nforce = require('nforce'),
    //meta = require('nforce-metadata')(nforce),
    glob = require('glob-all');

// Default options
var opt = {
	action: 'package',
	apiVersion: 34,
	fileChangeHashFile: '.force-developer.filehash.json',
	fileChangeHashStagingFile: '.force-developer.filehash.staging.json',
	projectBaseDirectory: 'project',
	outputDirectory: '.package',
	outputTempDirectory: 'src',
	outputPackageZip: './.package/package.zip',
	metadataSourceDirectory: 'app-metadata',
	environment: 'production',
	pollInterval: 500,
};

var force = {

  parsePackageJsonConfiguration: function(options) {

  	const packageFile = './package.json';

    // Read configuration from package.json (if possible).
    if (fs.existsSync(packageFile) === true) {
      var config = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
      if (config.forceDeveloperConfig !== undefined) {
      	for (var attrname in config.forceDeveloperConfig) { 
      		options[attrname] = config.forceDeveloperConfig[attrname]; 
      	}
      }
    }

    return options;
  },

  deletePackageOutput: function(options, cache) {

    if (cache === true) {
      if (fs.existsSync('./' + options.outputDirectory))
        fs.removeSync('./' + options.outputDirectory);
    }
    else {
      if (fs.existsSync('./' + options.outputDirectory + '/package.xml'))
        fs.removeSync('./' + options.outputDirectory + '/package.xml');

      if (fs.existsSync('./' + options.outputDirectory + '/src'))
        fs.removeSync('./' + options.outputDirectory + '/src');
    }
  },

  commitChangesToHashfile: function(options) {

    var fileDiffLive = './' + options.outputDirectory + '/' + options.fileChangeHashFile;
    var fileDiffStage = './' + options.outputDirectory + '/' + options.fileChangeHashStagingFile;

    // Commit the staged changes to the most recent hashfile.
    fs.copySync(fileDiffStage, fileDiffLive);
  },

  evaluateProjectFiles: function(options) {

    // TODO: Add support for delete (?)

    // Used to track what actions need to take place.
    var metadataAction = {};

    var fileDiffLive = './' + options.outputDirectory + '/' + options.fileChangeHashFile;
    var fileDiffStage = './' + options.outputDirectory + '/' + options.fileChangeHashStagingFile;

    // Read the hash file (if possible) 
    var fileDiff = (fs.existsSync(fileDiffLive))
      ? fs.readJsonSync(fileDiffLive)
      : {}; 

    // Iterate through all folders under the project folder.
    glob.sync('./' + options.projectBaseDirectory + '/**/').forEach(function(dir) {
    //grunt.file.expand({ filter: 'isDirectory' }, './' + options.projectBaseDirectory + '/**').forEach(function(dir) {

      // TODO - check for config file.
      // If config file - check for processor.  If custom processor, hand off processing
      // customProc(dir, metadataAction, fillDiff)

      // If no custom provider, iterate through all files in the folder.
      glob.sync([dir + '*.*', '!' + dir, '!' + dir + 'force.config', '!' + dir + '*-meta.xml']).forEach(function(f) {
      //grunt.file.expand({ filter: 'isFile' }, [dir + '/*', '!' + dir + '/force.config', '!' + dir + '/*-meta.xml']).forEach(function(f) {

        // Read the file into memory
        var data = fs.readFileSync(f, 'utf8') //grunt.file.read(f);

        // Get any previous hash for the file.
        var existingHash = fileDiff[f];

        // Generate a hash for the data in the current file.
        var currentHash = crypto
          .createHash('md5')
          .update(data)
          .digest('hex');

        // Check to see if there is any difference in the file.
        if (existingHash != currentHash) {
          // If yes -- put an 'add' action for the file in the action collection.
          console.log('Change: ' + f);
          metadataAction[f] = { add: true };
        }

        // Save the latest hash for the file.
        fileDiff[f] = currentHash;

      });

    });

    // Persist the hashes to the staging file.
    fs.ensureFileSync(fileDiffStage);
    fs.writeJsonSync(fileDiffStage, fileDiff);

    // Return the actions to be performed.
    return metadataAction;

  },

  generatePackageStructure: function(options, metadataAction) {

    // TODO: make the packager customisable.
    // Suggestion: Make a packager for classes, pages and components that allows you to put the metadata in the source.

    // Create a path to the temp output dir.  This will house the unpackaged package.xml and source
    var targetSrc = './' + options.outputDirectory + '/' + options.outputTempDirectory + '/';

    var buildMetadata = function(f, metadataTarget, options) {

      var ext = path.extname(f);
      var name = path.basename(f, ext);

      var data = null;
      switch (ext) {
        case '.cls':
          data = '<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<ApexClass xmlns=\"http:\/\/soap.sforce.com\/2006\/04\/metadata\">\r\n    <apiVersion>' + options.apiVersion + '.0<\/apiVersion>\r\n    <status>Active<\/status>\r\n<\/ApexClass>';
          break;
        case '.page':
          data = '<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<ApexPage xmlns=\"http:\/\/soap.sforce.com\/2006\/04\/metadata\">\r\n    <apiVersion>' + options.apiVersion + '.0<\/apiVersion>\r\n    <availableInTouch>false<\/availableInTouch>\r\n    <confirmationTokenRequired>false<\/confirmationTokenRequired>\r\n    <label>' + name + '<\/label>\r\n<\/ApexPage>';
          break;
        case '.component':
          data = '<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<ApexComponent xmlns=\"http:\/\/soap.sforce.com\/2006\/04\/metadata\">\r\n    <apiVersion>' + options.apiVersion + '.0<\/apiVersion>\r\n    <label>' + name + '<\/label>\r\n<\/ApexComponent>';
          break;
      }

      fs.ensureFileSync(metadataTarget);
      fs.writeFileSync(metadataTarget, data, 'utf8');

    };

    // 
    var copier = function(options, f, objectDir, hasMetadata) {

      var target = targetSrc + objectDir;

      var sourceFilename = path.basename(f);
      var targetFilename = target + '/' + sourceFilename;

      fs.ensureFileSync(targetFilename);
      fs.copySync(f, targetFilename);

      if (hasMetadata) {
        
        var metadataFilename = sourceFilename + '-meta.xml';
        var metadataTarget = target + '/' + metadataFilename;

        var matches = glob.sync(
          options.projectBaseDirectory + '/**/*' + metadataFilename
        );

        if (matches.length > 0) {
          fs.ensureFileSync(metadataTarget);
          fs.copySync(matches[0], metadataTarget);
        }
        else {
          var metadataSource = './' + options.projectBaseDirectory + '/' + options.metadataSourceDirectory + '/' + metadataFilename;

          console.log('Generating metadata - ' + metadataTarget);
          buildMetadata(f, metadataTarget, options);
        }
        
      }
    };

    for(var f in metadataAction) {
      
      var ext = path.extname(f);

      // TODO: Check for custom packager for a file ext.

      switch (ext) {
        case '.app':
          copier(options, f, 'applications', false);
          break;
        case '.approvalProcess':
          copier(options, f, 'approvalProcesses', false);
          break;
        case '.assignmentRules':
          copier(options, f, 'assignmentRules', false);
          break;
        case '.authproviders':
          copier(options, f, 'authprovider', false);
          break;
        case '.autoResponseRules':
          copier(options, f, 'autoResponseRules', false);
          break;
        case '.cls':
          copier(options, f, 'classes', true);
          break;
        case '.community':
          copier(options, f, 'communities', false);
          break;
        case '.component':
          copier(options, f, 'components', true);
          break;
        case '.group':
          copier(options, f, 'group', false);
          break;
        case '.homePageLayout':
          copier(options, f, 'homePageLayouts', false);
          break;
        case '.labels':
          copier(options, f, 'labels', false);
          break;
        case '.layout':
          copier(options, f, 'layouts', false);
          break;
        case '.letter':
          copier(options, f, 'letterhead', false);
          break;
        case '.object':
          copier(options, f, 'objects', false);
          break;
        case '.object':
          copier(options, f, 'objects', false);
          break;
        case '.objectTranslation':
          copier(options, f, 'objectTranslations', false);
          break;
        case '.page':
          copier(options, f, 'pages', true);
          break;
        case '.permissionset':
          copier(options, f, 'permissionsets', false);
          break;
        case '.profile':
          copier(options, f, 'profiles', false);
          break;
        case '.queue':
          copier(options, f, 'queues', false);
          break;
        case '.quickAction':
          copier(options, f, 'quickActions', false);
          break;
        case '.remoteSite':
          copier(options, f, 'remoteSiteSettings', false);
          break;
        case '.reportType':
          copier(options, f, 'reportTypes', false);
          break;
        case '.role':
          copier(options, f, 'role', false);
          break;
        case '.resource':
          copier(options, f, 'staticresources', true);
          break;
        case '.tab':
          copier(options, f, 'tabs', false);
          break;
        case '.trigger':
          copier(options, f, 'triggers', true);
          break;
      }

    }

    // TODO: load generic package XML file from filesystem. 
    var packageXml = '<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<Package xmlns=\"http:\/\/soap.sforce.com\/2006\/04\/metadata\">\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>AnalyticSnapshot<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>ApexClass<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>ApexComponent<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>ApexPage<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>ApexTrigger<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>ApprovalProcess<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>AssignmentRules<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>AuthProvider<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>AutoResponseRules<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>BusinessProcess<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>CallCenter<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Community<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>CompactLayout<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>ConnectedApp<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>CustomApplication<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>CustomApplication<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>CustomApplicationComponent<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>CustomField<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>CustomLabels<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>CustomObject<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>CustomObjectTranslation<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>CustomPageWebLink<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>CustomSite<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>CustomTab<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Dashboard<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>DataCategoryGroup<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Document<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>EmailTemplate<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>EntitlementProcess<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>EntitlementTemplate<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>ExternalDataSource<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>FieldSet<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Flow<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Group<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>HomePageComponent<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>HomePageLayout<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Layout<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Letterhead<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>ListView<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>LiveChatAgentConfig<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>LiveChatButton<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>LiveChatDeployment<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>MilestoneType<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>NamedFilter<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Network<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>PermissionSet<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Portal<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>PostTemplate<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Profile<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Queue<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>QuickAction<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>RecordType<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>RemoteSiteSetting<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Report<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>ReportType<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Role<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>SamlSsoConfig<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Scontrol<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>SharingReason<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Skill<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>StaticResource<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Territory<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>Translations<\/name>\r\n    <\/types>\r\n    <types>\r\n        <members>*<\/members>\r\n        <name>ValidationRule<\/name>\r\n    <\/types>\r\n    <version>32.0<\/version>\r\n<\/Package>';
    fs.writeFileSync(targetSrc + 'package.xml', packageXml, 'utf8');

  },

  generatePackageZip: function(options) {

  	return new Promise(function(resolve, reject) {

	    // Create a path to the temp output dir.  This will house the unpackaged package.xml and source
	    var packageSrc = './' + options.outputDirectory + '/' + options.outputTempDirectory + '/';

	    if (fs.existsSync(options.outputPackageZip) === true)
	    	fs.unlinkSync(options.outputPackageZip);

	    var archive = archiver('zip');
	    var output = fs.createWriteStream(options.outputPackageZip);

	    archive.on('error', function(err) {
	    	reject(err);
	    });

	    output.on('close', function() {
	    	resolve();
	    });

	    archive.pipe(output);
	    archive.directory(packageSrc, 'unpackaged');
	    archive.finalize();

	});

  },

  registerForGulp: function(gulp, gutil) {

	// TODO: consider moving output Directory to system temp dir & use https://www.npmjs.com/package/temporary

	// Modify the default options with any stored in a package json file.
	gulp.task('force-package-config', function(done) {     
	  opt = force.parsePackageJsonConfiguration(opt);
      done();
	});

	// -------------------------------------------

	// Clear the meta data output directory & difference cache file.
	gulp.task('force-reset', function(done) {     
      force.deletePackageOutput(opt, true);
      done();
	});

	// -------------------------------------------

	// Generate a zip package with changed files.
    gulp.task('force-package', function(done) {

      // Detect any new file or modified files.
      var metadataAction = force.evaluateProjectFiles(opt);

      // Clear the meta data output directory.
      force.deletePackageOutput(opt, false);

      // Check to see if any file changes were detected.
      if (Object.keys(metadataAction).length == 0) {
      	var msg = 'No new or modified files detected.';

		// Throw a gulp error to note no file changes detected.
      	if (gutil !== undefined && gutil !== null) 
      		throw new gutil.PluginError(gulpPluginName, msg, { showProperties: false, showStack: false });
      	
      	// Return an error to gulp.
      	console.log(msg);
      	done(msg);

        return;
      }

      // Generate package folder structure with new & modified files.
      force.generatePackageStructure(opt, metadataAction);

      done();

    });

	// -------------------------------------------


	gulp.task('force-zip', function() {

		// Wanted to keep everything in the force class so delegate the zipping instead of using gulp.
		return force.generatePackageZip(opt);

	});

	// -------------------------------------------

	// Replace the hashfile with the staging hashfile.
    gulp.task('force-commit', function(done) {
      force.commitChangesToHashfile(opt);
      done();
    });

  }

};

// ---------------------------------------------------------------------------------------------------

module.exports = force;