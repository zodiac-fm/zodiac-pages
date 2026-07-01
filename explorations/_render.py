#!/usr/bin/env python3
"""Render every exploration option to a trimmed, phone-true PNG for the review page.
Usage: python3 _render.py [name ...]   (default: all)"""
import subprocess, sys, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# name -> (query string for the target page, iframe height)
PAGES = {
    "lander-a": ("", 9000), "lander-b": ("", 9000), "lander-c": ("", 9000),
    "begin-a": ("?step=1", 844), "begin-a-s4": ("begin-a.html?step=4&noon=1", 844),
    "begin-b": ("", 4000),
    "results-a": ("", 11000), "results-b": ("", 11000), "results-c": ("", 11000),
    "checkout-a": ("", 5000), "checkout-b": ("", 5000),
    "quiz-a-1": ("quiz-a.html?beat=1", 844), "quiz-a-2": ("quiz-a.html?beat=2", 844), "quiz-a-3": ("quiz-a.html?beat=3", 844),
    "quiz-b-1": ("quiz-b.html?beat=1", 844), "quiz-b-2": ("quiz-b.html?beat=2", 844), "quiz-b-3": ("quiz-b.html?beat=3", 844),
    "quiz-c-1": ("quiz-c.html?beat=1", 844), "quiz-c-2": ("quiz-c.html?beat=2", 844), "quiz-c-3": ("quiz-c.html?beat=3", 844),
}

def src_for(name, q):
    if q.startswith("?") or q == "":
        base = name.split("-s")[0] + ".html" if name.endswith("-s4") else name + ".html"
        return base + q
    return q  # explicit "file.html?params"

def trim(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    bottom = h
    # walk up from the bottom past uniform rows (blank harness area)
    ref = px[w // 2, h - 1]
    for y in range(h - 1, 0, -1):
        row_ref = px[10, y]
        uniform = all(px[x, y] == row_ref for x in range(0, w, 37))
        if not uniform:
            bottom = min(h, y + 40)
            break
    if bottom < h:
        im.crop((0, 0, w, bottom)).save(path)

def render(name, q, hh):
    src = src_for(name, q)
    url = f"file://{HERE}/_phone.html?src={src.replace('&', '%26')}&h={hh}"
    out = os.path.join(HERE, "shots", name + ".png")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--force-device-scale-factor=1", f"--window-size=500,{hh + 20}",
                    f"--screenshot={out}", "--virtual-time-budget=9000", url],
                   capture_output=True, timeout=120)
    if os.path.exists(out):
        im = Image.open(out)
        im.crop((0, 0, 390, im.size[1])).save(out)
        trim(out)
        print("ok", name, Image.open(out).size)
    else:
        print("FAIL", name)

os.makedirs(os.path.join(HERE, "shots"), exist_ok=True)
targets = sys.argv[1:] or list(PAGES)
for n in targets:
    q, hh = PAGES[n]
    render(n, q, hh)
