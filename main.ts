import {
  z,
  ky,
  serve,
  b64encode,
  parseYaml,
  parsePath,
  spawnProcess,
} from "./deps.ts";

const VERSION = "0.0.0";

const optionsSchema = z.record(
  z.object({
    port: z.number(),
    base_port: z.number().optional(),
    run_path: z.string(),
    name: z.string(),
    argv: z.array(z.string()),
    gpu: z.boolean().optional(),
  })
);

const filePathWithFallback = async (
  base: string,
  path: string,
  fallback: string
) => {
  try {
    if (!(await Deno.stat(`${base}/${path}`)).isFile) {
      throw new Error("assertion failed");
    }
    return `${base}/${path}`;
  } catch {
    return `${base}/${fallback}`;
  }
};

const run = async (
  key: string,
  option: z.infer<typeof optionsSchema["valueSchema"]>,
  argv: string[]
) => {
  const proxyPort = option.port;
  const origPort = option.base_port || option.port - 1;
  const assets = "./engine_data/" + key;

  const corsPolicy = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "*",
    "Access-Control-Allow-Headers": "*",
  };
  let skipEngineWait = false;
  if (!option.run_path) {
    console.log(
      `${option.name} のエンジンにrun_pathが指定されていません。起動をスキップします。`
    );
    skipEngineWait = true;
  } else {
    try {
      const runPath = import.meta
        .resolve(option.run_path)
        .replace(/^file:\/\/\/?/, "");
      console.log(`${option.name} のエンジンを起動します。`);
      const runDir = parsePath(runPath).dir;
      console.log(`パス：${runPath}`);
      console.log(`ディレクトリ：${runDir}`);
      const processArgv = (option.argv || []).concat(argv);
      if (option.gpu === true && !processArgv.includes("--use_gpu")) {
        processArgv.push("--use_gpu");
      } else if (option.gpu === false && processArgv.includes("--use_gpu")) {
        processArgv.splice(processArgv.indexOf("--use_gpu"), 1);
      }
      const cmd = [runPath, `--port=${origPort}`, ...processArgv];
      console.log(`コマンド：${cmd.join(" ")}`);

      spawnProcess(runPath, [`--port=${origPort}`, ...processArgv], {
        cwd: runDir,
      });
      skipEngineWait = false;
    } catch (e) {
      console.error(`${option.name} のエンジンの起動に失敗しました。`);
      console.error(e);
      Deno.exit(1);
    }
  }

  const kyClient = ky.create({
    prefixUrl: `http://localhost:${origPort}`,
    keepalive: true,
    throwHttpErrors: false,
    timeout: false,
  });

  async function handler(req: Request): Promise<Response> {
    const path = req.url.replace(/^http:\/\/.+:[0-9]+\//g, "");
    let reqBody: ReadableStream | string | null = req.body;
    console.log(`${option.name}: ${req.method} ${path}`);
    if (reqBody && Deno.env.get("DEBUG")) {
      const body = await reqBody.getReader().read();
      const bodyStr = new TextDecoder().decode(body.value);

      reqBody = bodyStr;
    }

    const resp = await kyClient(path, {
      method: req.method,
      headers: Object.fromEntries([...req.headers]),
      body: reqBody,
    });
    if (path.startsWith("engine_manifest")) {
      const engineManifest = JSON.parse(
        await Deno.readTextFile(assets + "/engine_manifest.json")
      );
      engineManifest["dependency_licenses"] = JSON.parse(
        await Deno.readTextFile(
          await filePathWithFallback(
            assets,
            engineManifest["dependency_licenses"],
            "dependency_licenses.json"
          )
        )
      );
      engineManifest["icon"] = b64encode(
        await Deno.readFile(
          await filePathWithFallback(assets, engineManifest["icon"], "icon.png")
        )
      );
      engineManifest["supported_features"] = Object.fromEntries(
        Object.entries(engineManifest["supported_features"]).map(
          ([key, value]) => [key, (value as { value: boolean }).value]
        )
      );
      engineManifest["terms_of_service"] = await Deno.readTextFile(
        await filePathWithFallback(
          assets,
          engineManifest["terms_of_service"],
          "terms_of_service.md"
        )
      );
      engineManifest["update_infos"] = JSON.parse(
        await Deno.readTextFile(
          await filePathWithFallback(
            assets,
            engineManifest["update_infos"],
            "update_infos.json"
          )
        )
      );
      return new Response(JSON.stringify(engineManifest), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } else if (resp.status.toString().startsWith("2")) {
      // 2xx, do nothing
    } else if (path.startsWith("user_dict")) {
      if (req.method === "GET") {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsPolicy,
          },
        });
      }
    } else if (path.startsWith("import_user_dict")) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsPolicy,
        },
      });
    } else if (path.startsWith("is_initialized_speaker")) {
      return new Response(JSON.stringify(true), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsPolicy,
        },
      });
    }
    const body = await resp.blob();
    const respOptions = {
      status: resp.status,
      headers: Object.fromEntries([...resp.headers]),
    };
    delete respOptions.headers["content-length"];
    try {
      if (path.startsWith("version")) {
        const data: string = JSON.parse(await body.text());
        return new Response(JSON.stringify(data + "; vvproxy:" + VERSION), respOptions);
      } else {
        return new Response(body, respOptions);
      }
    } catch (e) {
      console.log(e);
      return new Response(body, respOptions);
    }
  }

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  if (!skipEngineWait) {
    console.log(`${option.name} のエンジンを起動しています...`);
    console.log(`${option.name} のホスト：http://localhost:${origPort}`);
    let started = false;
    for (let i = 0; i < 100; i++) {
      try {
        await kyClient.get("version");
        started = true;
        break;
      } catch (_) {
        await sleep(100);
      }
    }

    if (!started) {
      console.error(`${option.name} のエンジンが起動しませんでした。`);
      return;
    }
  }

  await serve(handler, {
    port: proxyPort,
    onListen: () => {
      console.log(
        `${option.name} のプロキシが起動しました：http://localhost:${proxyPort}`
      );
    },
  });
};

const config = await parseYaml(await Deno.readTextFile("./config.yml"));

try {
  const options = optionsSchema.parse(config);

  const [key, ...argv] = Deno.args;
  if (!options[key]) {
    console.error(`config.ymlに${key}が存在しません。`);
    Deno.exit(1);
  }
  run(key, options[key], argv);
} catch (e) {
  console.error(e);
  console.error("config.ymlが無効です。");
  Deno.stdin.read(new Uint8Array(1));
}
