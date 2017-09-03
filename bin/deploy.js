const fs         = require('fs');
const s3         = require('s3');
const path       = require('path');
const tempy      = require('tempy');
const rimraf     = require('rimraf');
const request    = require('request');
const jsonfile   = require('jsonfile');

const config = jsonfile.readFileSync(
	path.join(
		__dirname, 
		'./config.json'
	)
);

const s3Client = s3.createClient({
	s3Options: {
		region: config.s3.region,
		sslEnabled: true,
	}
});

function main() {
	const workdir = tempy.directory();

	const cleanUp = () => rimraf(workdir, () => console.log('Clean up done.'));

	fs.createReadStream(path.join(__dirname, config.page.template.main))
		.pipe(fs.createWriteStream(path.join(workdir, 'mainPageTemplate.html')));

	const widgetDefinitions = fs.readdirSync(config.widget.folder)
		.filter(file => {
			return fs.lstatSync(path.join(config.widget.folder, file)).isDirectory();
		})
		.map(dir => {
			return {
				dir, 
				path: path.join(config.widget.folder, dir)
			};
		})
		.map(dirPathObj => {
			fs.createReadStream(path.join(dirPathObj.path, `widget.html`))
				.pipe(fs.createWriteStream(path.join(workdir, `${dirPathObj.dir}.html`)));

			fs.createReadStream(path.join(dirPathObj.path, `previewImage.png`))
				.pipe(fs.createWriteStream(path.join(workdir, `${dirPathObj.dir}.png`)));

			return dirPathObj
		})
		.map(dirPathObj => {
			const widgetDefinition = jsonfile.readFileSync(path.join(dirPathObj.path, 'definition.json'));

			Object.assign(widgetDefinition, {
				previewImage: `https://s3-${config.s3.region}.amazonaws.com/${config.s3.bucket}/${config.s3.key_prefix}/${dirPathObj.dir}.png`,
				html: `${config.s3.key_prefix}/${dirPathObj.dir}.html`,
				slug: dirPathObj.dir
			});

			return widgetDefinition;
		});

	jsonfile.writeFileSync(path.join(workdir, 'widgetDefinition.json'), widgetDefinitions, {
		spaces: 2
	});

	const uploading = new Promise((resolve, reject) => {
		var uploader = s3Client.uploadDir({
			localDir: workdir,
			deleteRemoved: true,
			s3Params: {
				Bucket: config.s3.bucket,
				Prefix: `${config.s3.key_prefix}/`,
			}
		});

		uploader.on('error', function(err) {
			reject();
		});

		uploader.on('end', function() {
			resolve();
		});
	});

	uploading
		.then(() => {
			return request({
				url: `${config.api.root}/ImportWidgets`,
				json: true,
				body: widgetDefinitions,
				method: 'POST',
				headers: {
					'x-api-key': config.api.key
				}
			});
		})
		.then(() => console.log('Done uploading'))
		.catch((error) => console.error('Unable to sync: ', error))
		.then(() => cleanUp());
}

if (require.main === module) {
	main();
}