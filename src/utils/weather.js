// Weather service for route optimization
// Using OpenWeatherMap API for wind and weather data

// Get weather data for a location
export async function getWeatherData(latitude, longitude) {
  const API_KEY = process.env.REACT_APP_WEATHER_API_KEY;
  
  if (!API_KEY) {
    console.warn('Weather API key not configured');
    return null;
  }

  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${API_KEY}&units=metric`
    );

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();
    
    return {
      temperature: Math.round(data.main.temp),
      windSpeed: Math.round(data.wind.speed * 3.6), // Convert m/s to km/h
      windDirection: getWindDirection(data.wind.deg),
      windDegrees: data.wind.deg,
      description: data.weather[0].description,
      humidity: data.main.humidity,
      pressure: data.main.pressure,
      visibility: data.visibility / 1000, // Convert to km
      cloudCover: data.clouds.all,
      conditions: data.weather[0].main.toLowerCase(),
    };
  } catch (error) {
    console.error('Weather fetch failed:', error);
    return null;
  }
}

// Convert wind degrees to cardinal direction
function getWindDirection(degrees) {
  if (degrees === undefined || degrees === null) return 'Unknown';
  
  const directions = [
    'N', 'NNE', 'NE', 'ENE',
    'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW',
    'W', 'WNW', 'NW', 'NNW'
  ];
  
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

// Calculate if wind is favorable for a given bearing
export function isWindFavorable(routeBearing, windDegrees, windSpeed) {
  if (!windDegrees || !windSpeed || windSpeed < 5) {
    return 'neutral'; // Light wind doesn't matter much
  }

  // Calculate angle difference between route and wind direction
  let angleDiff = Math.abs(routeBearing - windDegrees);
  if (angleDiff > 180) {
    angleDiff = 360 - angleDiff;
  }

  // Classify wind based on angle
  if (angleDiff <= 45) {
    return 'headwind'; // Wind is against you
  } else if (angleDiff >= 135) {
    return 'tailwind'; // Wind is behind you
  } else {
    return 'crosswind'; // Wind is from the side
  }
}

// Get wind factor for route planning (0-1 scale, higher is better)
export function getWindFactor(routeBearing, windDegrees, windSpeed) {
  if (!windSpeed || windSpeed < 5) return 0.8; // Neutral for light wind

  const windDirection = isWindFavorable(routeBearing, windDegrees, windSpeed);
  const windStrength = Math.min(windSpeed / 30, 1); // Normalize to 0-1 (30km/h = strong)

  switch (windDirection) {
    case 'tailwind':
      return 0.9 + (0.1 * windStrength); // Bonus for tailwind
    case 'headwind':
      return 0.7 - (0.3 * windStrength); // Penalty for headwind
    case 'crosswind':
      return 0.8 - (0.1 * windStrength); // Small penalty for crosswind
    default:
      return 0.8;
  }
}

// Determine best time for different training types based on weather
export function getOptimalTrainingConditions(weatherData, trainingGoal) {
  if (!weatherData) return null;

  const { windSpeed, temperature, conditions } = weatherData;
  
  // Base scoring
  let score = 0.5;
  let recommendations = [];

  // Temperature scoring (15-25°C is ideal)
  if (temperature >= 15 && temperature <= 25) {
    score += 0.2;
    recommendations.push('Perfect temperature for cycling');
  } else if (temperature < 10) {
    score -= 0.2;
    recommendations.push('Cold weather - dress warmly');
  } else if (temperature > 30) {
    score -= 0.1;
    recommendations.push('Hot weather - stay hydrated');
  }

  // Wind considerations by training type
  switch (trainingGoal) {
    case 'intervals':
      if (windSpeed < 10) {
        score += 0.2;
        recommendations.push('Low wind ideal for intervals');
      } else {
        score -= 0.1;
        recommendations.push('Windy conditions may affect interval quality');
      }
      break;
      
    case 'endurance':
      if (windSpeed < 20) {
        score += 0.1;
      }
      break;
      
    case 'recovery':
      if (windSpeed < 15) {
        score += 0.15;
        recommendations.push('Calm conditions perfect for recovery');
      }
      break;
  }

  // Weather conditions
  if (['clear', 'few clouds'].includes(conditions)) {
    score += 0.1;
    recommendations.push('Clear skies for great visibility');
  } else if (['rain', 'thunderstorm'].includes(conditions)) {
    score -= 0.3;
    recommendations.push('Consider indoor training due to weather');
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    recommendations,
    suitable: score > 0.6
  };
}

// Mock weather data for development/fallback
export function getMockWeatherData() {
  return {
    temperature: 18,
    windSpeed: 12,
    windDirection: 'SW',
    windDegrees: 225,
    description: 'partly cloudy',
    humidity: 65,
    pressure: 1013,
    visibility: 10,
    cloudCover: 25,
    conditions: 'clouds',
  };
}