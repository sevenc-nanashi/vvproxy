== vvproxy --------------------------------------------------------------------
    vvproxy / ボイボ派生アプリを強引に追加エンジンとして読み込むプロキシ
    Version: !version!
    Developed by 名無し｡ (@sevenc-nanashi / https://sevenc7c.com/)
    https://github.com/sevenc-nanashi/vvproxy
-------------------------------------------------------------------------------

Voicevoxの派生アプリのエンジンをVoicevoxの複数エンジンで読み込むことが
できるようにするプロキシです。

-- 使い方  ・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・

1. config.ymlを編集します。

run_pathをそれぞれのエンジンの実行ファイルのパスに変更します。
例：itvoice-extractorを使ってインストールしたITVoiceの場合：

  run_path: C:\Users\[ユーザー名]\AppData\Local\Programs\itvoice\run.exe

2. Voicevoxを起動します。

エンジン→エンジンの管理→追加→フォルダを選択し、「engine_data」フォルダ内の
フォルダを選択します。

任意：LMRoid、Coeiroinkのアイコンを変更したい場合は、engine_data内に
「icon.local.png」を追加してください。

-- 注意  ・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・

このプロジェクトは、それぞれのアプリの開発者とは一切関係がありません。
このプロジェクトによって生じたいかなる損害についても、開発者は一切の責任を
負いません。

それぞれの派生アプリがVoicevoxの追加エンジンとして読み込めるようになった時、
このプロジェクトは終了します。
