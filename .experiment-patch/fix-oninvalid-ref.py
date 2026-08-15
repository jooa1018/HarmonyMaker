from pathlib import Path

path = Path("src/app/review/wag-v102-selector-experiment/ReviewClient.tsx")
text = path.read_text(encoding="utf-8")
old = """  const onInvalidRef = useRef(onInvalid);
  onInvalidRef.current = onInvalid;
  const [renderedAbc, setRenderedAbc] = useState<string | null>(null);"""
new = """  const onInvalidRef = useRef(onInvalid);
  useEffect(() => {
    onInvalidRef.current = onInvalid;
  }, [onInvalid]);
  const [renderedAbc, setRenderedAbc] = useState<string | null>(null);"""
if text.count(old) != 1:
    raise SystemExit(f"expected one onInvalid ref block, found {text.count(old)}")
path.write_text(text.replace(old, new), encoding="utf-8")
