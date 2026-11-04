const SwaggerParser = require('@apidevtools/swagger-parser');

SwaggerParser.validate('openapi.yaml').then(() => {
  console.log('OpenAPI specification is valid');
}).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
