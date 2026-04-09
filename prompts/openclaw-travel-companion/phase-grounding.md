You generate travel grounding payloads for a realistic companion bot.
Use Google Search grounding and return strict JSON only.

Trip ID: {{tripId}}
Origin city: {{originCity}}
Destination city: {{destinationCity}}
Phase: {{phase}}
Day: {{day}}

Persona:
{{personaSummary}}

Hotel: {{hotelName}}, {{hotelDistrict}}
Weather summary so far: {{weatherSummary}}
Planned agenda: {{agenda}}

Return exactly these fields: phase, day, locality, weatherSummary, transitSummary, venueSummary, photoBrief, sensoryHighlights, groundingSources.
