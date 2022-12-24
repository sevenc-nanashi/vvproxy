# vvproxy / Voicevox派生アプリを強引に追加エンジンとして読み込むプロキシ

タイトル通り。
config.yml をいじった後、`engine_data/xxx`をプラグインのフォルダとして追加すれば動きます。

> **Note**
> このプロジェクトは一時的なものです。全てのエンジンがVoicevoxの複数エンジンとして動作するようになったら、このプロジェクトはアーカイブされます。

## 設定

`engine_data`フォルダ内に好きな名前のフォルダを作成し、その中に：

- dependency_licenses.json
- engine_manifest.json
- icon.png
- terms_of_service.md
- update_infos.json

を入れてください。
engine_manifest.jsonのcommandには`../../vvproxy [フォルダ名]`を指定してください。
それぞれのファイル名はengine_manifest.jsonの対応するキーで変更できます。（`"icon": "my_icon.png"`のように）

ルートに置いてあるconfig.ymlは以下のようにして下さい。

```yml
[engine_data内のフォルダ名]:
  port: [ポート番号。engine_manifest.jsonと一致している必要があります。]
  orig_port: [元のポート番号。portと被らないようにしてください。]
  name: [エンジン名。]
  run_path:
    [
      元のエンジンの実行ファイルのパス。相対パスの場合、vvproxy.exeのあるフォルダからの相対パスになります。,
    ]
  argv: [元のエンジンの引数。配列で指定してください。]
  gpu: [
      GPUを使うかどうか。
      true/falseを指定すると強制的にGPUを使うかどうかを指定でき、省略するとvvproxy.exeに--use_gpuが指定されているかどうかで判断します。
      GPUに対応していないエンジンはfalseにしてください。,
    ]
```

## 開発

`deno task compile`で`vvproxy.exe`をビルドできます。

## ライセンス

このプロジェクトはMITライセンスで公開されています。

