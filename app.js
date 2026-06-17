const originInput = document.getElementById('origin');
const destinationInput = document.getElementById('destination');
const departureDateInput = document.getElementById('departure-date');
const departureTimeInput = document.getElementById('departure-time');
const planButton = document.getElementById('plan-trip');
const errorMessage = document.getElementById('error-message');
const resultsSection = document.getElementById('results');
const timelineCards = document.getElementById('timeline-cards');
const apiKeyBanner = document.getElementById('api-key-banner');
const apiKeyInput = document.getElementById('api-key-input');
const saveApiKeyBtn = document.getElementById('save-api-key');

let map = null;
let directionsRenderer = null;

const today = new Date();
departureDateInput.value = today.toISOString().split('T')[0];
departureDateInput.min = today.toISOString().split('T')[0];
const maxDate = new Date(today);
maxDate.setDate(maxDate.getDate() + 14);
departureDateInput.max = maxDate.toISOString().split('T')[0];

if (!localStorage.getItem('gmaps_api_key')) {
    apiKeyBanner.classList.remove('hidden');
}

saveApiKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) return;
    localStorage.setItem('gmaps_api_key', key);
    location.reload();
});

function initApp() {
    apiKeyBanner.classList.add('hidden');

    try {
        const originAutocomplete = new google.maps.places.Autocomplete(originInput, {
            types: ['geocode', 'establishment']
        });
        const destAutocomplete = new google.maps.places.Autocomplete(destinationInput, {
            types: ['geocode', 'establishment']
        });

        resultsSection.classList.remove('hidden');
        map = new google.maps.Map(document.getElementById('map'), {
            center: { lat: 39.8283, lng: -98.5795 },
            zoom: 4,
            mapTypeControl: false,
            streetViewControl: false,
        });

        directionsRenderer = new google.maps.DirectionsRenderer({
            map: map,
            suppressMarkers: true,
            polylineOptions: { strokeColor: '#3182ce', strokeWeight: 4, strokeOpacity: 0.8 }
        });

        planButton.addEventListener('click', () => planTrip());
    } catch (err) {
        showError('Google Maps failed to initialize: ' + err.message + '. Make sure "Maps JavaScript API", "Places API", and "Directions API" are all enabled in your Google Cloud Console.');
    }
}
window.initApp = initApp;

let routeMarkers = [];

function clearMarkers() {
    routeMarkers.forEach(m => m.setMap(null));
    routeMarkers = [];
}

async function planTrip() {
    hideError();

    if (!originInput.value.trim()) {
        showError('Please enter a starting point.');
        return;
    }
    if (!destinationInput.value.trim()) {
        showError('Please enter a destination.');
        return;
    }
    if (!departureDateInput.value) {
        showError('Please select a departure date.');
        return;
    }

    planButton.disabled = true;
    planButton.textContent = 'Planning...';
    resultsSection.classList.remove('hidden');
    timelineCards.innerHTML = '<div class="loading">Calculating route and fetching weather...</div>';

    try {
        const route = await getRoute(originInput.value, destinationInput.value);
        const departureDateTime = new Date(`${departureDateInput.value}T${departureTimeInput.value}:00`);
        const waypoints = sampleWaypoints(route, departureDateTime);
        const weatherData = await getWeatherForWaypoints(waypoints);
        displayResults(route, weatherData);
    } catch (err) {
        showError('Something went wrong: ' + err.message);
        resultsSection.classList.add('hidden');
    } finally {
        planButton.disabled = false;
        planButton.textContent = 'Plan My Trip';
    }
}

function getRoute(origin, destination) {
    return new Promise((resolve, reject) => {
        const directionsService = new google.maps.DirectionsService();
        directionsService.route(
            {
                origin: origin,
                destination: destination,
                travelMode: google.maps.TravelMode.DRIVING,
            },
            (result, status) => {
                if (status === 'OK') {
                    resolve(result);
                } else {
                    reject(new Error('Could not find a route. ' + status));
                }
            }
        );
    });
}

function sampleWaypoints(directionsResult, departureTime) {
    const route = directionsResult.routes[0];
    const leg = route.legs[0];
    const totalDuration = leg.duration.value;
    const totalDistance = leg.distance.value;
    const path = route.overview_path;

    const numStops = Math.min(Math.max(Math.ceil(totalDuration / 3600), 3), 12);
    const waypoints = [];

    for (let i = 0; i < numStops; i++) {
        const fraction = i / (numStops - 1);
        const pathIndex = Math.min(Math.floor(fraction * (path.length - 1)), path.length - 1);
        const point = path[pathIndex];
        const elapsedSeconds = fraction * totalDuration;
        const arrivalTime = new Date(departureTime.getTime() + elapsedSeconds * 1000);
        const distanceKm = (fraction * totalDistance / 1000).toFixed(0);

        waypoints.push({
            lat: point.lat(),
            lon: point.lng(),
            arrivalTime,
            distanceKm,
            isStart: i === 0,
            isEnd: i === numStops - 1,
        });
    }

    waypoints[0].locationName = leg.start_address.split(',')[0];
    waypoints[numStops - 1].locationName = leg.end_address.split(',')[0];

    return waypoints;
}

async function reverseGeocode(lat, lon) {
    return new Promise((resolve) => {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: { lat, lng: lon } }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const components = results[0].address_components;
                const city = components.find(c => c.types.includes('locality'));
                const county = components.find(c => c.types.includes('administrative_area_level_2'));
                resolve(city ? city.long_name : county ? county.long_name : results[0].formatted_address.split(',')[0]);
            } else {
                resolve(`${lat.toFixed(2)}, ${lon.toFixed(2)}`);
            }
        });
    });
}

async function getWeatherForWaypoints(waypoints) {
    const locationPromises = waypoints.map(wp => {
        if (wp.locationName) return Promise.resolve(wp.locationName);
        return reverseGeocode(wp.lat, wp.lon);
    });
    const locationNames = await Promise.all(locationPromises);

    const weatherPromises = waypoints.map(async (wp, i) => {
        const dateStr = wp.arrivalTime.toISOString().split('T')[0];
        const hour = wp.arrivalTime.getHours();
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${wp.lat}&longitude=${wp.lon}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,weathercode,windspeed_10m&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`;

        const res = await fetch(url);
        const data = await res.json();
        const hourIndex = Math.min(hour, (data.hourly.time || []).length - 1);

        return {
            ...wp,
            locationName: locationNames[i],
            temperature: data.hourly.temperature_2m[hourIndex],
            humidity: data.hourly.relative_humidity_2m[hourIndex],
            precipitationProb: data.hourly.precipitation_probability[hourIndex],
            weatherCode: data.hourly.weathercode[hourIndex],
            windSpeed: data.hourly.windspeed_10m[hourIndex],
        };
    });

    return Promise.all(weatherPromises);
}

function weatherCodeToInfo(code) {
    const mapping = {
        0: { icon: '☀️', desc: 'Clear sky' },
        1: { icon: '🌤️', desc: 'Mainly clear' },
        2: { icon: '⛅', desc: 'Partly cloudy' },
        3: { icon: '☁️', desc: 'Overcast' },
        45: { icon: '🌫️', desc: 'Foggy' },
        48: { icon: '🌫️', desc: 'Freezing fog' },
        51: { icon: '🌦️', desc: 'Light drizzle' },
        53: { icon: '🌦️', desc: 'Moderate drizzle' },
        55: { icon: '🌧️', desc: 'Heavy drizzle' },
        61: { icon: '🌧️', desc: 'Light rain' },
        63: { icon: '🌧️', desc: 'Moderate rain' },
        65: { icon: '🌧️', desc: 'Heavy rain' },
        66: { icon: '❄️', desc: 'Freezing rain' },
        67: { icon: '❄️', desc: 'Heavy freezing rain' },
        71: { icon: '🌨️', desc: 'Light snow' },
        73: { icon: '🌨️', desc: 'Moderate snow' },
        75: { icon: '🌨️', desc: 'Heavy snow' },
        77: { icon: '❄️', desc: 'Snow grains' },
        80: { icon: '🌦️', desc: 'Light showers' },
        81: { icon: '🌧️', desc: 'Moderate showers' },
        82: { icon: '⛈️', desc: 'Violent showers' },
        85: { icon: '🌨️', desc: 'Light snow showers' },
        86: { icon: '🌨️', desc: 'Heavy snow showers' },
        95: { icon: '⚡', desc: 'Thunderstorm' },
        96: { icon: '⚡', desc: 'Thunderstorm with hail' },
        99: { icon: '⚡', desc: 'Thunderstorm with heavy hail' },
    };
    return mapping[code] || { icon: '❓', desc: 'Unknown' };
}

function displayResults(directionsResult, weatherData) {
    directionsRenderer.setDirections(directionsResult);
    clearMarkers();
    timelineCards.innerHTML = '';

    weatherData.forEach((wp, i) => {
        const info = weatherCodeToInfo(wp.weatherCode);

        const marker = new google.maps.Marker({
            position: { lat: wp.lat, lng: wp.lon },
            map: map,
            title: wp.locationName,
            label: wp.isStart ? 'A' : wp.isEnd ? 'B' : `${i + 1}`,
        });

        const infoWindow = new google.maps.InfoWindow({
            content: `<b>${wp.locationName}</b><br>${info.icon} ${info.desc}<br>${Math.round(wp.temperature)}°C`
        });
        marker.addListener('click', () => infoWindow.open({ anchor: marker, map }));
        routeMarkers.push(marker);

        const card = document.createElement('div');
        const cardClass = wp.isStart ? 'start' : wp.isEnd ? 'end' : '';
        card.className = `weather-card ${cardClass}`;

        const timeStr = wp.arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = wp.arrivalTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        const label = wp.isStart ? 'Departure' : wp.isEnd ? 'Arrival' : `${wp.distanceKm} km`;

        card.innerHTML = `
            <div class="time-info">
                <div class="location-name">${wp.locationName}</div>
                <div class="arrival-time">${timeStr} · ${dateStr}</div>
                <div class="arrival-time">${label}</div>
            </div>
            <div class="weather-icon">${info.icon}</div>
            <div class="weather-details">
                <div class="temp">${Math.round(wp.temperature)}°C</div>
                <div class="description">${info.desc}</div>
                <div class="extra">
                    Wind: ${Math.round(wp.windSpeed)} km/h ·
                    Rain: ${wp.precipitationProb}% ·
                    Humidity: ${wp.humidity}%
                </div>
            </div>
        `;

        timelineCards.appendChild(card);
    });
}

function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
}

if (!localStorage.getItem('gmaps_api_key')) {
    planButton.addEventListener('click', () => {
        showError('Please enter your Google Maps API key first.');
    });
}
