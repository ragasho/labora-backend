// Increase the default timeout for tests, as database operations can be slow.
jest.setTimeout(30000);

// By not changing any environment variables here, our tests will
// use the same database and Redis connection details as our main application,
// as defined in the .env file and config files.