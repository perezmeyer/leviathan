module.exports = {
	core: {
		host: process.env.CORE_HOST || 'core',
		port: process.env.CORE_PORT || 2000
	},
	balena: {
		apiUrl: 'https://api.balena-cloud.com',
	},
	leviathan: {
		artifacts: 'artifacts',
	},
};
