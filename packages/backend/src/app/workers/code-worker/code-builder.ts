import fs from "node:fs/promises";
import decompress from "decompress";
import { sandboxManager } from "../sandbox";
import { logger } from "../../helper/logger";
import { packageManager, PackageManagerDependencies } from "../../helper/package-manager";

const webpackConfig = `
  const path = require("node:path");

  module.exports = {
    mode: "production",
    target: "node",
    entry: path.join(__dirname, "index.ts"),
    module: {
      rules: [
        {
          test: /\\.ts$/,
          use: [
            {
              loader: "ts-loader",
              options: {
                // don't check types
                transpileOnly: true,
              },
            },
          ],
        }
      ]
    },
    resolve: {
      // add 'ts' to the default extensions
      extensions: [".ts", "..."],
      preferRelative: true,
    },
    output: {
      // enables the use of 'module.exports', see: https://github.com/webpack/webpack/issues/1114
      libraryTarget: "commonjs2",
      path: path.join(__dirname, "dist"),
      filename: "index.js",
    },
  };
`;

const tsConfig = `
  {
    // preset config for node 18
    "extends": "@tsconfig/node18/tsconfig.json"
  }
`;

async function build(artifact: Buffer): Promise<Buffer> {
    const sandbox = sandboxManager.obtainSandbox();
    const buildPath = sandbox.getSandboxFolderPath();
    let bundledFile: Buffer;
    try {
        const startTime = Date.now();
        logger.info(`Started Building in sandbox: ${buildPath}`);

        await sandbox.cleanAndInit();
        await downloadFiles(artifact, buildPath);

        const dependencies: PackageManagerDependencies = {
            "@tsconfig/node18": "1.0.1",
            "ts-loader": "9.4.2",
            "typescript": "4.8.4",
            "webpack": "5.74.0",
            "webpack-cli": "4.10.0",
        };

        await packageManager.addDependencies(buildPath, dependencies);

        await packageManager.runLocalDependency(buildPath, "webpack");

        bundledFile = await fs.readFile(`${buildPath}/dist/index.js`);

        logger.info(`Finished Building in sandbox: ${buildPath}, duration: ${Date.now() - startTime}ms`);
    }
    catch (e) {
        logger.error(e, "code builder");

        const invalidArtifactTemplate = await fs.readFile("./packages/backend/src/assets/invalid-code.js");

        const invalidArtifactFile = invalidArtifactTemplate
            .toString("utf-8")
            .replace("${ERROR_MESSAGE}", JSON.stringify(e.toString()).replace(/"/g, '\\"'));

        bundledFile = Buffer.from(invalidArtifactFile, "utf-8");
    }
    finally {
        sandboxManager.returnSandbox(sandbox.boxId);
    }

    return bundledFile;
}

async function downloadFiles(artifact: Buffer, buildPath: string) {
    const webpackConfigPath = `${buildPath}/webpack.config.js`;
    const tsConfigPath = `${buildPath}/tsconfig.json`;

    await decompress(artifact, buildPath, {});

    await fs.writeFile(webpackConfigPath, webpackConfig);
    await fs.writeFile(tsConfigPath, tsConfig);
}

export const codeBuilder = {
    build,
};
