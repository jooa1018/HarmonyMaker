"""Real local provider/image regression. Inputs are self-authored repository fixtures."""
from fractions import Fraction
from hashlib import sha256
import json
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen
from uuid import uuid4
from xml.etree import ElementTree as ET

base, api_key = sys.argv[1:3]
fixtures = Path(__file__).resolve().parents[1] / "services/audiveris-provider/tests/fixtures/native-ocr"
expected_pitches = [
    "C4 D4 E4 F4 G4 A4 G4 F4", "D4 G4 B4 G4 A4 B4 A4 G4",
    "C4 E4 A4 E4 G4 A4 G4 E4", "C4 F4 A4 C4 G4 A4 G4 F4",
]
expected_durations = [Fraction(1, 2)] * 4 + [Fraction(1, 4), Fraction(3, 4), Fraction(1, 2), Fraction(1, 2)]
expected_chords = [("C", "major"), ("G", "major"), ("A", "minor"), ("F", "major")]


def request(path, method="GET", data=None, headers=None):
    h = {"Authorization": "Bearer " + api_key, **(headers or {})}
    if isinstance(data, dict):
        data = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    with urlopen(Request(base.rstrip("/") + path, data=data, headers=h, method=method), timeout=30) as response:
        return response.read()


for label in ("standard", "small"):
    data = (fixtures / f"{label}.png").read_bytes()
    logical_key = "native-smoke-" + str(uuid4())
    job = json.loads(request("/v1/jobs", "POST", {"pageCount": 1, "idempotencyKey": logical_key + "-create"}))["jobId"]
    started = time.monotonic()
    try:
        request(f"/v1/jobs/{job}/pages/0", "PUT", data, {
            "Content-Type": "image/png", "Idempotency-Key": logical_key + "-upload", "X-Page-Digest": sha256(data).hexdigest(),
        })
        request(f"/v1/jobs/{job}/start", "POST", {"idempotencyKey": logical_key + "-start"})
        status = {"kind": "processing"}
        while time.monotonic() - started < 900:
            try:
                status = json.loads(request(f"/v1/jobs/{job}/status"))
            except TimeoutError:
                # Resume observation of the same handle within the original
                # deadline. A lost status response is not an engine failure.
                print(json.dumps({"fixture": label, "observation": "status response timed out; same job retained"}), flush=True)
                continue
            if status["kind"] in ("completed", "failed"):
                break
            time.sleep(2)
        assert status["kind"] == "completed", status
        root = ET.fromstring(request(f"/v1/jobs/{job}/result"))
        # This title is recognized from pixels by Audiveris; the independent
        # chord OCR does not create it. Language presence alone cannot pass.
        assert root.findtext("movement-title") == "Harmony Beam Study"
        measures = root.find("part").findall("measure")
        assert len(measures) == 4
        divisions = None
        for index, measure in enumerate(measures):
            if measure.find("attributes/divisions") is not None:
                divisions = int(measure.findtext("attributes/divisions"))
            notes = measure.findall("note")
            pitches = ["".join(note.findtext("pitch/" + part, "") for part in ("step", "alter", "octave")) for note in notes]
            assert pitches == expected_pitches[index].split(), (label, index, pitches)
            assert [Fraction(note.findtext("duration")) / divisions for note in notes] == expected_durations
            harmonies = measure.findall("harmony")
            assert [(h.findtext("root/root-step"), h.findtext("kind")) for h in harmonies] == [expected_chords[index]]
            assert list(measure).index(harmonies[0]) < list(measure).index(notes[0])
            assert Fraction(harmonies[0].findtext("offset", "0")) == 0
        print(json.dumps({"fixture": label, "status": "PASS", "nativeTitle": True, "exactNotes": 32,
                          "exactChordsAndOnsets": 4, "seconds": round(time.monotonic() - started, 2)}), flush=True)
    finally:
        request(f"/v1/jobs/{job}", "DELETE", headers={"Idempotency-Key": logical_key + "-delete"})
