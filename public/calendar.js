// Calendar helpers for the Story Lead Board: turn a board event into a
// Google Calendar link or an .ics file. Times are Claremont local time.
(function (root) {
  const TZ = "America/New_York";
  const SITE = "https://events.claremontv.org";

  // "10:00 AM–3:00 PM", "3:00–5:00 PM", "6:00 PM", "8:30 AM", "Daytime", "All day"
  // -> { allDay:true } or { start:"HHMM", end:"HHMM" }  (single time defaults to 2 hours)
  function span(t) {
    const re = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/gi;
    const found = [];
    let m;
    while ((m = re.exec(String(t || ""))) && found.length < 2) {
      found.push({ h: +m[1], min: +(m[2] || 0), ap: (m[3] || "").toUpperCase() });
    }
    if (!found.length || found.every(x => !x.ap && !String(t).includes(":"))) return { allDay: true };
    if (found.length === 2 && !found[0].ap) found[0].ap = found[1].ap; // "3:00–5:00 PM"
    const to24 = x => {
      let h = x.h % 12;
      if (x.ap === "PM") h += 12;
      if (!x.ap && x.h < 8) h += 12; // bare "6:00" is evening, not 6 AM
      return h * 60 + x.min;
    };
    const s = to24(found[0]);
    let e = found[1] ? to24(found[1]) : s + 120;
    if (e <= s) e = s + 120;
    if (e > 23 * 60 + 59) e = 23 * 60 + 59;
    const hhmm = n => String(Math.floor(n / 60)).padStart(2, "0") + String(n % 60).padStart(2, "0");
    return { start: hhmm(s), end: hhmm(e) };
  }

  const ymd = d => d.replace(/-/g, "");
  const nextDay = d => {
    const x = new Date(d + "T12:00:00Z");
    x.setUTCDate(x.getUTCDate() + 1);
    return x.toISOString().slice(0, 10);
  };

  function details(e, who) {
    return [
      who ? `Covering: ${who}` : "",
      e.angle ? `Angle: ${e.angle}` : "",
      e.t ? `Listed time: ${e.t}` : "",
      e.url ? `Event info: ${e.url}` : "",
      `CCMC Story Lead Board: ${SITE}`,
    ].filter(Boolean).join("\n");
  }

  function dates(e) {
    const sp = span(e.t);
    return sp.allDay
      ? { allDay: true, a: ymd(e.d), b: ymd(nextDay(e.d)) }
      : { allDay: false, a: `${ymd(e.d)}T${sp.start}00`, b: `${ymd(e.d)}T${sp.end}00` };
  }

  function googleUrl(e, who) {
    const d = dates(e);
    const p = new URLSearchParams({
      action: "TEMPLATE",
      text: `CCMC shoot: ${e.title}`,
      dates: `${d.a}/${d.b}`,
      details: details(e, who),
      location: [e.venue, e.town].filter(Boolean).join(", "),
    });
    if (!d.allDay) p.set("ctz", TZ);
    return "https://calendar.google.com/calendar/render?" + p.toString();
  }

  const icsText = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const fold = line => line.match(/.{1,73}/g).join("\r\n ");

  function ics(e, who) {
    const d = dates(e);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CCMC//Story Lead Board//EN", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${e.id}@events.claremontv.org`,
      `DTSTAMP:${stamp}`,
      d.allDay ? `DTSTART;VALUE=DATE:${d.a}` : `DTSTART;TZID=${TZ}:${d.a}`,
      d.allDay ? `DTEND;VALUE=DATE:${d.b}` : `DTEND;TZID=${TZ}:${d.b}`,
      `SUMMARY:${icsText("CCMC shoot: " + e.title)}`,
      `LOCATION:${icsText([e.venue, e.town].filter(Boolean).join(", "))}`,
      `DESCRIPTION:${icsText(details(e, who))}`,
      e.url ? `URL:${e.url}` : "",
      "END:VEVENT", "END:VCALENDAR",
    ].filter(Boolean);
    return lines.map(fold).join("\r\n") + "\r\n";
  }

  root.CCMCcal = { span, googleUrl, ics };
  if (typeof module !== "undefined") module.exports = root.CCMCcal;
})(typeof window !== "undefined" ? window : globalThis);
