import React, { useMemo } from 'react';
import { Paper, Title, Text, Group, Tooltip } from '@mantine/core';
import dayjs from 'dayjs';
import minMax from 'dayjs/plugin/minMax';

dayjs.extend(minMax);

const ActivityHeatmap = ({ routes, formatDistance }) => {
  // Generate heatmap data for the last year
  const heatmapData = useMemo(() => {
    const today = dayjs();
    // Show last 52 weeks, but if no recent data, adjust to show where the data actually is
    let startDate = today.subtract(52, 'weeks').startOf('week');
    let endDate = today.endOf('week');
    
    // Find the actual date range of the data
    if (routes.length > 0) {
      const routeDates = routes.map(r => dayjs(r.created_at));
      const earliestRoute = dayjs.min(routeDates);
      const latestRoute = dayjs.max(routeDates);
      
      // If the latest route is more than a year old, show the last year of actual activity
      if (latestRoute.isBefore(today.subtract(1, 'year'))) {
        endDate = latestRoute.endOf('week');
        startDate = endDate.subtract(52, 'weeks').startOf('week');
      }
    }
    
    
    // Create a map of date -> activity data
    const activityMap = {};
    routes.forEach(route => {
      const date = dayjs(route.created_at).format('YYYY-MM-DD');
      if (!activityMap[date]) {
        activityMap[date] = {
          rides: 0,
          distance: 0,
          elevation: 0
        };
      }
      activityMap[date].rides += 1;
      activityMap[date].distance += route.distance_km || 0;
      activityMap[date].elevation += route.elevation_gain_m || 0;
    });
    

    // Generate weeks array
    const weeks = [];
    let currentWeek = [];
    let currentDate = startDate;

    while (currentDate.isBefore(endDate) || currentDate.isSame(endDate, 'day')) {
      const dateStr = currentDate.format('YYYY-MM-DD');
      const activity = activityMap[dateStr] || { rides: 0, distance: 0, elevation: 0 };
      
      // Determine intensity level (0-4) based on distance
      let level = 0;
      if (activity.distance > 0) {
        if (activity.distance >= 100) level = 4; // Epic ride
        else if (activity.distance >= 50) level = 3; // Long ride
        else if (activity.distance >= 20) level = 2; // Medium ride
        else level = 1; // Short ride
      }

      currentWeek.push({
        date: currentDate.toDate(),
        dateStr,
        level,
        activity,
        dayOfWeek: currentDate.day()
      });

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }

      currentDate = currentDate.add(1, 'day');
    }

    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
    }

    return weeks;
  }, [routes]);

  // Color scheme for cycling (different from GitHub)
  const getColor = (level) => {
    switch (level) {
      case 0: return '#f1f5f9'; // Light gray for no activity
      case 1: return '#dbeafe'; // Light blue for short rides
      case 2: return '#93c5fd'; // Medium blue for medium rides  
      case 3: return '#3b82f6'; // Blue for long rides
      case 4: return '#1d4ed8'; // Dark blue for epic rides
      default: return '#f1f5f9';
    }
  };

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['', 'M', '', 'W', '', 'F', ''];

  return (
    <Paper p="md" withBorder>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={4}>Activity Heatmap</Title>
          <Text size="sm" c="dimmed">Your cycling activity over the past year</Text>
        </div>
      </Group>

      <div style={{ overflowX: 'auto' }}>
        {/* Month labels */}
        <div style={{ display: 'flex', marginBottom: '8px', marginLeft: '20px' }}>
          {months.map((month, index) => (
            <div
              key={month}
              style={{
                width: `${100 / 12}%`,
                fontSize: '12px',
                color: '#6b7280',
                textAlign: 'left'
              }}
            >
              {month}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex' }}>
          {/* Day labels */}
          <div style={{ display: 'flex', flexDirection: 'column', marginRight: '8px' }}>
            {days.map((day, index) => (
              <div
                key={index}
                style={{
                  height: '12px',
                  marginBottom: '2px',
                  fontSize: '10px',
                  color: '#6b7280',
                  lineHeight: '12px',
                  textAlign: 'right',
                  width: '12px'
                }}
              >
                {day}
              </div>
            ))}
          </div>

          {/* Heatmap grid */}
          <div style={{ display: 'flex', gap: '2px' }}>
            {heatmapData.map((week, weekIndex) => (
              <div key={weekIndex} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {week.map((day, dayIndex) => (
                  <Tooltip
                    key={`${weekIndex}-${dayIndex}`}
                    label={
                      <div>
                        <Text size="xs" fw={500}>
                          {dayjs(day.date).format('MMM D, YYYY')}
                        </Text>
                        {day.activity.rides > 0 ? (
                          <div>
                            <Text size="xs">
                              {day.activity.rides} ride{day.activity.rides > 1 ? 's' : ''}
                            </Text>
                            <Text size="xs">
                              {formatDistance(day.activity.distance)}
                            </Text>
                            <Text size="xs">
                              ↗ {Math.round(day.activity.elevation)}m elevation
                            </Text>
                          </div>
                        ) : (
                          <Text size="xs">No rides</Text>
                        )}
                      </div>
                    }
                    position="top"
                    withArrow
                  >
                    <div
                      style={{
                        width: '12px',
                        height: '12px',
                        backgroundColor: getColor(day.level),
                        borderRadius: '2px',
                        cursor: 'pointer',
                        border: '1px solid #e5e7eb'
                      }}
                    />
                  </Tooltip>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', marginTop: '16px', gap: '8px' }}>
          <Text size="xs" c="dimmed">Less</Text>
          {[0, 1, 2, 3, 4].map(level => (
            <div
              key={level}
              style={{
                width: '12px',
                height: '12px',
                backgroundColor: getColor(level),
                borderRadius: '2px',
                border: '1px solid #e5e7eb'
              }}
            />
          ))}
          <Text size="xs" c="dimmed">More</Text>
          <Text size="xs" c="dimmed" style={{ marginLeft: '16px' }}>
            Based on distance: 0km, &lt;20km, 20-50km, 50-100km, 100km+
          </Text>
        </div>
      </div>
    </Paper>
  );
};

export default ActivityHeatmap;