var salesforcePackageFile = './.package/package.zip',
    username = 'testuser@force.com',
    password ='password',
    token = 'Qr1ScFquCn1uT0YO6ywUj5je';

// ----------------------------------------------------------------

var gulp = require('gulp'),
	gutil = require('gulp-util'),
	forceDeploy = require('gulp-jsforce-deploy');

require('./gulp-force-developer').registerForGulp(gulp, gutil);

// ----------------------------------------------------------------
// REGISTER GULP TASKS

gulp.task('deploy', function(done) {
	
	return gulp.src(salesforcePackageFile)
	    .pipe(forceDeploy({
	      username: username,
	      password: password + token,
	      pollInterval: 5*1000 
	      //, loginUrl: 'https://test.salesforce.com' 
	      //, pollTimeout: 120*1000 
	      //, version: '33.0' 
	    }));
	    
});

gulp.task('default', gulp.series(
	'force-package-config',
	'force-package',
	'force-zip',
	'deploy',
	'force-commit'
));
