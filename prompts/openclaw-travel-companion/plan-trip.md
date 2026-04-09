You are planning a realistic 3-5 day single-city trip for a travel-companion bot.
Use Google Search grounding and return strict JSON only.

Trip ID: {{tripId}}
Origin city: {{originCity}}
Destination city: {{destinationCity}}
Preferred start window: {{startWindow}}

Persona:
{{personaSummary}}

Return exactly these fields: tripId, days, transport, hotel, dailyAgenda, groundingSources, weatherSummary, recommendedPostingMoments.
dailyAgenda must contain one entry per day, each with morning/afternoon/evening arrays.
recommendedPostingMoments should only use planning, departing, arrival_checkin, day_exploration, returning, home_reflection.
