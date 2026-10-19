"""Generate a second export of the same synthetic notes (Anki 26.9.3, MIT).

Unlike generate.py this only writes updated.apkg; the original packages stay intact.
"""

import base64
import json
import tempfile
import wave
from pathlib import Path

from anki.collection import Collection
from anki.import_export_pb2 import ExportAnkiPackageOptions

with tempfile.TemporaryDirectory(prefix="repeaty-anki-updates-") as directory:
    collection = Collection(str(Path(directory) / "collection.anki2"))
    models = []
    for kind in [0, 4]:
        model = json.loads(collection._backend.get_stock_notetype_legacy(kind))
        model["id"] = collection.models.add_dict(model).id
        models.append(model)
    media = Path(collection.media.dir())
    (media / "pixel.png").write_bytes(base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9HcAAAAASUVORK5CYII="
    ))
    # Same filename, MIME type and size, different audio samples.
    with wave.open(str(media / "voice.wav"), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b"\1\0" * 800)

    def add(model, guid, front, back, tags=None):
        note = collection.new_note(model)
        note.guid = guid
        note.fields = [front, back]
        note.tags = tags if tags is not None else ["Anki", "中文"]
        collection.add_note(note, 1)

    add(models[0], "rpt-basic", '<div>What is <b>3 + 3</b>?</div><img src="pixel.png">', '<div>Six. 更新后的答案</div>[sound:voice.wav]<pre>return 6</pre>' + '<p>Long text for comparison. 中文长文本。' + 'More context. ' * 120 + '</p>', ["Anki", "更新"])
    add(models[0], "rpt-reverse", "hello", "你好")
    add(models[1], "rpt-cloze", "The {{c1::capital::place}} of France is {{c3::Paris}}.", "Remember the city.")
    add(models[0], "rpt-safe", "Safe text", "A safe answer")
    add(models[0], "rpt-new", 'A newly added note.<img src="pixel.png">', "It shares the unchanged image.")
    collection.export_anki_package(
        out_path=str(Path(__file__).with_name("updated.apkg")),
        options=ExportAnkiPackageOptions(with_scheduling=False, with_media=True, legacy=False),
        limit=None,
    )
    collection.close()
