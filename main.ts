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
    run_path: z.string().optional(),
    name: z.string(),
    argv: z.array(z.string()),
    gpu: z.boolean().optional(),
    force_restart: z.boolean().optional(),
  })
);

type CoeiroinkDownloadInfo = {
  downloadable_model: {
    download_path: string;
    volume: string;
    speaker: {
      name: string;
      speaker_uuid: string;
      styles: {
        name: string;
        id: number;
      }[];
      version: string;
    };
    speaker_info: {
      policy: string;
      portrait: string;
      style_infos: {
        id: number;
        name: string;
        voice_samples: string[];
      }[];
    };
  };
  current_version: string;
  character_exists: boolean;
  latest_model_exists: boolean;
};

const coeiroinkDownloadInfosToDownloadableLibraries = (
  infos: CoeiroinkDownloadInfo[]
) =>
  infos.map((info) => {
    const volumeMatch =
      info.downloadable_model.volume.match(/([\d.]+) ([GMK])/);
    const bytes = volumeMatch
      ? Number(volumeMatch[1]) *
        (volumeMatch[2] === "G"
          ? 1024 ** 3
          : volumeMatch[2] === "M"
          ? 1024 ** 2
          : 1024)
      : 0;
    return {
      name: info.downloadable_model.speaker.name,
      uuid: info.downloadable_model.speaker.speaker_uuid,
      version: info.downloadable_model.speaker.version,
      download_url: info.downloadable_model.download_path,
      bytes,

      speakers: [
        {
          speaker: info.downloadable_model.speaker,
          speaker_info: info.downloadable_model.speaker_info,
        },
      ],
    };
  });

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

  const kyClient = ky.create({
    prefixUrl: `http://localhost:${origPort}`,
    keepalive: true,
    throwHttpErrors: false,
    timeout: false,
  });

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
    const started = await kyClient
      .get("version")
      .then(() => true)
      .catch(() => false);
    if (started && !option.force_restart) {
      console.log(
        `${option.name} のエンジンは既に起動しています。起動をスキップします。`
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

        const engineProcess = spawnProcess(
          runPath,
          [`--port=${origPort}`, ...processArgv],
          {
            cwd: runDir,
          }
        );
        Deno.addSignalListener("SIGINT", () => {
          console.log(
            `SIGINTを受け取りました。${option.name} のエンジン（PID：${engineProcess.pid}）を終了します。`
          );
          engineProcess.kill();
          Deno.exit(0);
        });
        engineProcess.on("exit", (code) => {
          console.log(
            `${option.name} のエンジン（PID：${engineProcess.pid}）が終了しました。コード：${code}`
          );
          Deno.exit(code);
        });
        skipEngineWait = false;
      } catch (e) {
        console.error(`${option.name} のエンジンの起動に失敗しました。`);
        console.error(e);
        Deno.exit(1);
      }
    }
  }

  async function handler(req: Request): Promise<Response> {
    let path = req.url.replace(/^http:\/\/.+:[0-9]+\//g, "");
    if (path === "/downloadable_libraries") {
      path = "/download_infos";
    }

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
    } else if (path.startsWith("downloadable_libraries")) {
      const downloadInfos = await kyClient("download_infos").json();
      if (!Array.isArray(downloadInfos))
        throw new Error("assert: downloadInfos is not array");
      return new Response(
        JSON.stringify(
          coeiroinkDownloadInfosToDownloadableLibraries(downloadInfos)
        ),
        {
          headers: {
            "content-type": "application/json",
            ...corsPolicy,
          },
        }
      );
    } else if (path.startsWith("installed_libraries")) {
      const downloadInfos = await kyClient("download_infos").json();
      if (!Array.isArray(downloadInfos))
        throw new Error("assert: downloadInfos is not array");
      return new Response(
        JSON.stringify(
          coeiroinkDownloadInfosToDownloadableLibraries(
            downloadInfos.filter((i) => i.latest_model_exists)
          )
        ),
        {
          headers: {
            "content-type": "application/json",
            ...corsPolicy,
          },
        }
      );
    }
    if (resp.status === 204) {
      return new Response(null, {
        status: 204,
        headers: Object.fromEntries([...resp.headers]),
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
        return new Response(
          JSON.stringify(data + "; vvproxy:" + VERSION),
          respOptions
        );
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
