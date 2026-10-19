# Anki import fixtures

`legacy.apkg` and `modern.apkg` were exported by Anki 26.9.3 using its official Python library. `generate.py` creates all content and media; no personal collection or third-party deck is included. The fixtures are covered by this repository's MIT license.

Each export contains seven notes: Basic with HTML, math, code, Unicode, a shared PNG and WAV; reversed; Cloze with two numbers; unsupported SVG; nested Cloze; inert script and external-image examples; and an unsupported script template. One card has scheduling data and a review entry, which Repeaty deliberately imports as a new card.

Regenerate from the repository root in a separate Python environment:

```sh
pip install anki==26.9.3
python tests/fixtures/anki/generate.py
```

Anki is only needed to regenerate these files. CI reads the committed packages directly.
