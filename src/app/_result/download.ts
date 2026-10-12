export function downloadMusicXml(xml: string, title: string) {
  const url = URL.createObjectURL(new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" }));
  const link = document.createElement("a");
  link.href = url; link.download = `${(title || "화음 악보").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")}.musicxml`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
