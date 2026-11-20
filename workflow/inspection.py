"""Mesh inspection and bounded ElevenLabs speech for a single committed solid."""
import base64
import binascii
from http.client import HTTPSConnection, HTTPException
import json
import math
import os
import re

from qa.verify_stl import inspect_bytes

MAX_STL_BYTES = 1024 * 1024
MAX_AUDIO_BYTES = 256 * 1024
MAX_CAPTION_CHARS = 180
SMALL = ("zero one two three four five six seven eight nine ten eleven twelve "
         "thirteen fourteen fifteen sixteen seventeen eighteen nineteen").split()
TENS = "zero ten twenty thirty forty fifty sixty seventy eighty ninety".split()


def spoken_dimension(length):
    """Use the inspector's two-decimal precision and spell common presets for Flash."""
    rounded = round(length, 2)
    if rounded == 0 and length > 0:
        return f"{length:.2g}"
    if rounded < 100 and rounded.is_integer():
        value = int(rounded)
        if value < 20:
            return SMALL[value]
        tens, ones = divmod(value, 10)
        return TENS[tens] + ("-" + SMALL[ones] if ones else "")
    if rounded >= 1e9:
        return f"{rounded:.6g}"
    return f"{rounded:.2f}".rstrip("0").rstrip(".")


def inspect_upload(upload):
    if type(upload) is not dict or set(upload) != {"revision", "stlBase64"}:
        raise ValueError("Send one STL and its committed revision.")
    revision = upload["revision"]
    if type(revision) is not int or not 0 <= revision <= 2**53 - 1:
        raise ValueError("Invalid scene revision.")
    encoded = upload["stlBase64"]
    if type(encoded) is not str or len(encoded) > 4 * math.ceil(MAX_STL_BYTES / 3):
        raise ValueError("The selected STL exceeds the inspection size limit or is missing.")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("Invalid STL encoding.") from error
    if len(raw) > MAX_STL_BYTES:
        raise ValueError("The selected STL exceeds the inspection size limit.")
    audit = inspect_bytes(raw)
    dimensions = audit["dimensions_mm"]
    bounds = " by ".join(spoken_dimension(length) for length in dimensions).capitalize()
    closed = audit["closed_consistent_surface"]
    passage = audit["center_passage"]
    if passage:
        condition = "The mesh is closed, and the centre passage is open."
    elif closed:
        condition = "The mesh is closed."
    else:
        condition = "The mesh has open or inconsistently joined edges."
    return {
        "revision": revision, "dimensionsMm": dimensions, "triangles": audit["triangles"],
        "closed": closed, "centerPassage": passage, "caption": f"{bounds} millimetres. {condition}",
    }


def speak_caption(caption):
    key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    voice = os.getenv("ELEVENLABS_VOICE_ID", "").strip()
    unavailable = {"audioBase64": None, "audioStatus": "unavailable"}
    if not key or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", voice):
        return unavailable
    if len(caption) > MAX_CAPTION_CHARS:
        raise ValueError("Inspection caption exceeds the speech budget.")
    connection = HTTPSConnection("api.elevenlabs.io", timeout=12)
    try:
        path = f"/v1/text-to-speech/{voice}?output_format=mp3_22050_32"
        body = json.dumps({"text": caption, "model_id": "eleven_flash_v2_5"})
        connection.request("POST", path, body, {
            "xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg",
        })
        response = connection.getresponse()
        if response.status != 200:
            return unavailable
        audio = response.read(MAX_AUDIO_BYTES + 1)
        # Validate MPEG sync or an ID3 header before offering a playable result.
        mpeg = len(audio) >= 4 and (audio.startswith(b"ID3") or audio[0] == 255 and (audio[1] & 224) == 224)
        if not mpeg or len(audio) > MAX_AUDIO_BYTES:
            return unavailable
        return {"audioBase64": base64.b64encode(audio).decode("ascii"), "audioStatus": "ready"}
    except (HTTPException, OSError, ValueError):
        return unavailable
    finally:
        connection.close()
