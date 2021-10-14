const fs = require('fs')
const path = require('path')
const execa = require('execa')
const yargs = require('yargs-parser')
const { copy, removeSync } = require('fs-extra')
const colors = require('kleur')
const { exit } = require('process')

const errorLink = `${colors.underline('https://github.com/indexorg/create-index-app/issues')}`

function logError(msg) {
	console.error(colors.red().bold(`${msg}`))
  	exit(1)
}

function printStep(line, subline = false) {
	console.log(colors.green().inverse().bold(line) + (subline ? colors.green().dim('  ' + subline) : ''))
}

function hasPmInstalled(packageManager) {
	try {
	  	execa.commandSync(`${packageManager} --version`)
	  	return true
	} catch (err) {
	  	return false
	}
}

async function cleanProject(dir) {
	const packageManifest = path.join(dir, 'package.json')
	removeSync(path.join(dir, 'package-lock.json'))
	removeSync(path.join(dir, 'node_modules'))
	removeSync(path.join(dir, '.gitignore'))
	removeSync(path.join(dir, '.npmignore'))
	removeSync(path.join(dir, 'LICENSE'))
  
	const {
		scripts, 
		webDependencies, 
		dependencies, 
		devDependencies
	} = require(packageManifest)

	const {
		prepare,
		start,
		build,
		test,
		...otherScripts
	} = scripts

	await fs.promises.writeFile(
	  	packageManifest,
	  	JSON.stringify({
			scripts: {
				prepare, 
				start,
				build,
				test,
				...otherScripts
			},
			webDependencies,
			dependencies,
			devDependencies,
		}, null, 2)
	)
}
  
async function verifyProjectTemplate(isLocalTemplate, {template, dir}) {
	let keywords

	if (isLocalTemplate) {
	  	const packageManifest = path.join(dir, 'package.json');

	  	keywords = require(packageManifest).keywords
	} else {
		try {
			const {
				stdout
			} = await execa('npm', ['info', template, 'keywords', '--json']);
			
			keywords = JSON.parse(stdout)
		} catch (err) {
			console.log()
			console.error(colors.red().bold(`Cannot verify external template safely. If you believe this is incorrect, create an issue here:\n${errorLink}`))

			exit(1)
		}
	}
  
	if (!keywords || !keywords.includes('create-index-app--template')) {
		console.log()
		console.error(colors.red().bold(`The provided template is not an Index app template. Check the template name or create an issue here:\n${errorLink}`))

	  	exit(1)
	}
}

const validateArgs = (args) => {
    const {
        template, 
        useYarn, 
        usePnpm, 
        force, 
        target, 
        verbose, 
        _
    } = yargs(args)
    
	if (useYarn && usePnpm) {
      	logError('You cannot use yarn and pnpm at the same time.')
    }

    if (useYarn && !hasPmInstalled('yarn')) {
      	logError(`yarn doesn't seem to be installed.`)
    }
    if (usePnpm && !hasPmInstalled('pnpm')) {
      	logError(`pnpm doesn't seem to be installed.`)
    }

    if (!target && _.length === 2) {
      	logError('Missing --target directory.')
    }
    if (typeof template !== 'string') {
      	logError('Missing --template argument.')
    }
    if (_.length > 3) {
      	logError('Unexpected extra arguments.')
    }

    const targetDirectoryRelative = target || _[2]
    const targetDirectory = path.resolve(process.cwd(), targetDirectoryRelative)
	
    if (fs.existsSync(targetDirectory) && !force) {
		logError(`${targetDirectory} already exists. Use \`--force\` to overwrite this directory.`)
    }

    return {
		template,
		useYarn,
		usePnpm,
		targetDirectoryRelative,
		targetDirectory,
		verbose,
    }
}

const {
    template,
    useYarn,
    usePnpm,
    targetDirectory,
    verbose,
} = validateArgs(process.argv)

let installer = 'npm'
if (useYarn) {
	installer = 'yarn'
} else if (usePnpm) {
	installer = 'pnpm'
}

const isLocalTemplate = template.startsWith('.')
const installedTemplate = isLocalTemplate
  ? path.resolve(process.cwd(), template) // handle local template
  : path.join(targetDirectory, 'node_modules', template); // handle template from npm/yarn

(async () => {
	const currentVersion = process.versions.node
	const requiredMajorVersion = parseInt(currentVersion.split('.')[0], 10)
	const minimumMajorVersion = 10

	if (requiredMajorVersion < minimumMajorVersion) {
		console.error(`Node.js v${currentVersion} is out of date and unsupported!`)
		console.error(`Please use Node.js v${minimumMajorVersion} or higher.`)
		process.exit(1)
	}

	const intro = `
            |
          |||||
        |||||||||         
       |||||||||||         
      |||||||||||||        Thank you for using Leaf! Please
      |||||||||||||        visit ${colors.underline('https://indexforwp.com/leaf')}
       |||||||||||
        |||||||||
          |||||
`

	console.log(`\n ${colors.green(intro)}`)

	printStep('Verifying template...')

	await verifyProjectTemplate(isLocalTemplate, {dir: installedTemplate, template})

	console.log(colors.green(colors.bold('\nTemplate: ') + template))
	console.log(colors.green(colors.bold('Target directory: ') + targetDirectory))

	fs.mkdirSync(
		targetDirectory, 
		{ recursive: true }
	)

	await fs.promises.writeFile(
		path.join(targetDirectory, 'package.json'), 
		`{"name": "my-ndx-app"}`
	);
	
	// fetch from npm or GitHub if not local (which will be most of the time)
	if (!isLocalTemplate) {
		try {
		await execa(
			'npm',
			['install', template, '--ignore-scripts', '--loglevel', verbose ? 'verbose' : 'error'],
			{
				cwd: targetDirectory,
				all: true,
			},
		);
		} catch (err) {
			// Only log output if the command failed
			console.error(err.all)
			throw err
		}
	}

	await copy(installedTemplate, targetDirectory)
	await cleanProject(targetDirectory)

	console.log('\n')

	const npmInstallOptions = {
		cwd: targetDirectory,
		stdio: 'inherit',
	}

	printStep('Setting up packages...', 'this might take a minute')

	function installProcess(packageManager) {
		switch (packageManager) {
			case 'npm':
				return execa(
					'npm',
					['install', '--loglevel', verbose ? 'verbose' : 'error'],
					npmInstallOptions,
				)
			case 'yarn':
				return execa('yarn', [verbose ? '--verbose' : '--silent'], npmInstallOptions)
			case 'pnpm':
				return execa(
					'pnpm',
					['install', `--reporter=${verbose ? 'default' : 'silent'}`],
					npmInstallOptions,
				)
			default:
				throw new Error('Unspecified package installer')
		}
	}

	const npmInstallProcess = installProcess(installer)

	npmInstallProcess.stdout && npmInstallProcess.stdout.pipe(process.stdout)
	npmInstallProcess.stderr && npmInstallProcess.stderr.pipe(process.stderr)

	await npmInstallProcess

	console.log('\n')

	printStep(`Leaf is setup! Go to "${targetDirectory} to see your project`)
})()