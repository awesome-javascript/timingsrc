/*
	Copyright 2015 Norut Northern Research Institute
	Author : Ingar Mæhlum Arntzen

  This file is part of the Timingsrc module.

  Timingsrc is free software: you can redistribute it and/or modify
  it under the terms of the GNU Lesser General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  Timingsrc is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Lesser General Public License for more details.

  You should have received a copy of the GNU Lesser General Public License
  along with Timingsrc.  If not, see <http://www.gnu.org/licenses/>.
*/

define(['util/motionutils', 'util/eventutils', 'util/interval', './axis'], 
	function (motionutils, eventutils, Interval, axis)  {

	'use strict';

	// UTILITY

	var isMoving = function (vector) {
		return (vector.velocity !== 0.0 || vector.acceleration !== 0.0);
	};

	/*
      unique
      return list of elements that are unique to array 1
     */
    var unique = function (array1, array2) {
		var res = [];
		for (var i=0; i<array1.length;i++) {
		    var found = false;
		    for (var j=0; j<array2.length;j++) {
				if (array1[i] === array2[j]) {
				    found = true;
				    break;
				} 
	    	}
	   		if (!found) {
				res.push(array1[i]);
	    	}	 
		}
		return res;
    };


    // VERBS
    var VerbType = Object.freeze({
		ENTER: "enter",
		EXIT: "exit",
		CHANGE: "change",
		toInteger: function (s) {
		    if (s === VerbType.ENTER) return 1;
		    if (s === VerbType.EXIT) return -1;
		    if (s === VerbType.CHANGE) return 0;
		    throw new SequencerError("illegal string value verb type " + s);
		},
		fromInteger : function (i) {
			if (i === -1) return VerbType.EXIT;
			else if (i === 1) return VerbType.ENTER;
			else if (i === 0) return VerbType.CHANGE;
			throw new SequencerError("illegal integer value for direction type " + i);
		}
    });

    // DIRECTIONS
    var DirectionType = Object.freeze({
		BACKWARDS: "backwards",
		FORWARDS: "forwards",
		NODIRECTION : "nodirection",
		toInteger : function (s) {
		    if (s === DirectionType.BACKWARDS) return -1;
		    if (s === DirectionType.FORWARDS) return 1;
		    if (s === DirectionType.NODIRECTION) return 0;
		    throw new SequencerError("illegal string value direction type " + string);
		},
		fromInteger : function (i) {
			if (i === 0) return DirectionType.NODIRECTION;
			else if (i === -1) return DirectionType.BACKWARDS;
			else if (i === 1) return DirectionType.FORWARDS;
			throw new SequencerError("illegal integer value for direction type" + i + " " + typeof(i));
		}
    });


	/*

      SCHEDULE

      The purpose of schedule is to keep tasks planned for execution
      in the near future.
      
      <start> and <end> timestamps defines the time
      interval covered by the schedule - the <covering interval>. The
      idea is to move this interval stepwise, to eventually cover the
      entire time-line. The length of this interval is defined by the
      option <lookahead>. The default value is 5 seconds.

      The <advance> operation moves the interval so that the next
      interval <start> matches the previous interval <end>. If
      lookahead is 5 seconds, the general idea is to advance the
      covering interval every 5 seconds.  However, it is safe to
      advance it more often. It is also safe to advance it less
      often. In this case the covering interval will grow in length to
      cover otherwise lost parts of the timeline - but events will be 
      delivered too late.

      The push(ts,task) operation allows tasks to be added to the
      schedule, provided their due-times fall within the covering
      interval. The push_immediate(task) will assign <ts> === now.
      Push maintains time ordering.
      
      The pop() operation is used to get all tasks that are due for
      execution. The schedule should be popped regularly/frequently to
      keep tasks from being delayed in execution. The delay_next()
      operation returns the time (milliseconds) until the next task is
      due. This can be used with setTimeout() to arrange timely
      popping. However, note that this timeout may have to be
      re-evealuated as new tasks are pushed onto the schedule.

      Associated with the <covering interval> (time), there is also a
      "covering interval" with respect to timing object(position). Eg. In real-time
      (epoch) interval [1434891233.407, 1434891235.407] movement of timing object covers
      positions [23.0, 25.0].  All tasks are associated with a position on a
      dimension. This is set by the advance() operation.  The position
      interval is used (externally) to quickly evaluate relevance of tasks, essentially to
      avoid calculating the due-times of a task only to find that it falls
      outside the time convering interval. Position interval is only managed
      externally.

     */

    var Schedule = function (now, options) {
		this.queue = [];
		// options
		this.options = options || {};	
		this.options.lookahead = this.options.lookahead || 5.0;
		// time-interval
		this.timeInterval = new Interval(now, now + this.options.lookahead, true, true);
		// position-interval
		this.posInterval = null;
	};

	Schedule.prototype.getTimeInterval = function (){return this.timeInterval;};
	Schedule.prototype.getPosInterval = function (){return this.posInterval;};
	Schedule.prototype.setPosInterval = function (interval) {this.posInterval = interval;};
	Schedule.prototype.sortFunc = function(a,b) {return a.ts - b.ts;};

	// push
	// task assumed to have a key -- se usage by Sequencer
	Schedule.prototype.push = function (now, ts, task) {
		if (this.timeInterval.coversPoint(ts)) {
			var entry = {
			    ts: ts,
			    task: task,
		    	push_ts: now
			};
			if (ts >= now) {
			    this.queue.push(entry);
			    this.queue.sort(this.sortFunc); // maintain ordering
			    return true;
			} else {
				console.log("Schedule : task pushed a bit too late, ts < now ", (ts-now));
			}
	    }
	    return false;
	};

		// pop
	Schedule.prototype.pop = function (now) {
	    var res = [];
	    while (this.queue.length > 0 && this.queue[0].ts <= now) {
			var entry = this.queue.shift();
			var info = {
			    task: entry.task,
			    pop_ts: now, // fresh timestamp?
			    push_ts: entry.push_ts,
			    ts: entry.ts
			};
			res.push(info);
	    }
	    return res;
	};
		

	/* Invalidate task with given key */
	Schedule.prototype.invalidate = function (key) {
	    var i, index, entry, remove = [];
	    // Find
	    for (i=0; i<this.queue.length; i++) {
			entry = this.queue[i];
			if (entry.task.key === key) {
			    remove.push(entry);
			}
	    }
	    // Remove
	    for (i=0; i<remove.length; i++) {
			entry = remove[i];
			index = this.queue.indexOf(entry);
			if (index > -1) {
			    this.queue.splice(index, 1);
			}
		}
    };


    /*

  		ADVANCE

      The covering time interval is defined by [start,end>
      The covering interval should be advanced so that it always
      contains real-time, e.g., now.

      Advancing the covering interval assumes task queues to be empty.
      Therefore, make sure to pop all task before calling advance.

      Also, the time-sequence of covering intervals should ideally
      lay back-to-back on the time-line. To achive this the end of
      one interval becomes the start of the next. The end of the interval is 
      now + lookahead.
  
      If advance is called before the current interval is expired,
      the current interval is cut short.
  
      If advance is not called for an extended time, the next
      invocation will cause the covering interval to stretch long
      into the past.
    
      If parameter start is supplied, this is used as starting point
      for covering interval.

	*/

	Schedule.prototype.advance = function(now) {
	    if (now < this.timeInterval.low) {
			console.log("Schedule : Advancing backwards " + (now - this.timeInterval.low));
	    } 
	    this.queue = []; // drop tasks (time interval cut off)
	    this.timeInterval = new Interval(now, now + this.options.lookahead, false, true);
	    this.posInterval = null; // reset
	};
	
	/* 
		Current schedule is expired (at given time)
	*/	
	Schedule.prototype.isExpired = function(now) {
		return (now > this.timeInterval.high);
	};

	/* 
		delay until the next due task in schedule, or until the
		current time_interval expires 
	*/
	Schedule.prototype.getDelayNextTs = function (ts) {
	    // ts should be fresh timestamp in seconds
	    if (this.queue.length > 0) {
			return Math.max(0.0, this.queue[0].ts - ts);
	    }
	    return Math.max(0.0, this.timeInterval.high - ts);
	};


	
	/*
		BUILDER

		Build arguments for updateAll function of Sequencer
	*/

	var Builder = function (sequencer) {
		this._argOrder = [];
		this._argMap = {};
		this._sequencer = sequencer;
	};

	Builder.prototype.addCue = function (key, interval, data) {
		this._argOrder.push(key);
		this._argMap[key] = {key:key, interval:interval, data: data};
		return this;
	};
	
	Builder.prototype.removeCue = function (key, removedData) {
		return this.addCue(key, undefined, removedData);
	};

	Builder.prototype.submit = function () {
		var argList = [];
		this._argOrder.forEach(function (key) {
			argList.push(this._argMap[key]);
		}, this);
		// reset
		this._argMap = {};
		this._argOrder = [];
		if (argList.length > 0) {
			return this._sequencer.updateAll(argList);
		}
		return [];
	};


	/*
		Sequencer Error
	*/
	var SequencerError = function (message) {
		this.name = "SequencerError";
		this.message = (message || "");
	};
	SequencerError.prototype = Error.prototype;


	/*
		Sequencer EArgs
	*/
	var SequencerEArgs = function (sequencer, key, interval, data, point, pointType, ts, dueTs, directionType, verbType) {
		this.src = sequencer;
		this.key = key;
		this.interval = interval;
		this.point = point;
		this.pointType = pointType;
		this.dueTs = dueTs;
		this.delay = ts - dueTs;
		this.directionType = directionType;
		this.type = verbType;
		this.data = data;
	};

	SequencerEArgs.prototype.toString = function () {
		var s = "[" +  this.point.toFixed(2) + "]";
        s += " " + this.key;
        s += " " + this.interval.toString();
        s += " " + this.type;
        s += " " + this.directionType;
        s += " " + this.pointType;
        s += " delay:" + this.delay.toFixed(4);
        if (this.data) s += " " + JSON.stringify(this.data);
        return s;
	};


	/*
		SequencerCue
	*/
	var SequencerCue = function (key, interval, data) {
		this.key = key;
		this.interval = interval;
		this.data = data;
	};

	SequencerCue.prototype.toString = function () {
		var s = this.key + " " + this.interval.toString();
		if (this.data) s += " " + JSON.stringify(this.data);
		return s;
	};


	/*
	
		SEQUENCER

	*/
	var Sequencer = function (timingObject, _axis) {
		this._to = timingObject;
		this._clock = timingObject.clock;
		this._axis = _axis || new axis.Axis();
		this._schedule = null;
		this._timeout = null; // timeout	
		this._activeKeys = []; // active intervals

		// set up eventing stuff
		eventutils.eventify(this, Sequencer.prototype);
		this.eventifyDefineEvent("enter", {init:true}); // define enter event (supporting init-event)
		this.eventifyDefineEvent("exit"); 
		this.eventifyDefineEvent("change");

		// wrap prototype handlers and store ref on instance
		this._wrappedOnTimingChange = function () {this._onTimingChange();};
		this._wrappedOnAxisChange = function (e) {this._onAxisChange(e);};

		// initialise
		this._to.on("change", this._wrappedOnTimingChange, this);
		// Allow subclass to load data into the sequencer
		this.loadData();
	};


	/*
	  	overrides how immediate events are constructed 
	*/
	Sequencer.prototype.eventifyMakeInitEvents = function (type) {
		if (type === "enter") {
			return this._processInitialEvents();
		}
		return [];
	};

	// To be overridden by subclass specializations
	Sequencer.prototype.loadData = function () {};
	Sequencer.prototype.getData = function (key) {};

	/* 
	
		ON TIMING OBJECT CHANGE

		Whenever the timingobject position changes abruptly we need to
	        re-evaluate intervals. 

		A) Abrupt changes in position occur 
		   1) after certain timing object changes or 
		   2) when the timing object is initially loaded.

		B) Non-abrupts changes occur when velocity or acceleration is
		changed without immediately affecting the position

		In all cases - the schedule and timeout need to be re-evaluated.

        In case A. 1) the timing object change is possibly late due to network
        latency. To include effects of singulars/intervals from the small "lost"
        time interval, make sure to advance according to the timestamp of the
		timing object vector.  2) is not delayed.
     

        Furthermore in a small time-interval just before timing object updates
        the previous vector incorrectly drove the sequencer instead of the new
        updated vector.  This may have caused the sequencer to falsely
        report some events, and to not report other events.  This time
        interval is (initVector[T], now). For non-singular Intervals this will be
        corrected by the general re-evalution of Intervals. For singular Intervals
        explicit action is required to signal incorrect events. This implementation
        does not support this.

	*/

	Sequencer.prototype._isReady = function () {
		return (this._schedule !== null);
	};

	Sequencer.prototype._onTimingChange = function (event) {
		// Set the time for this processing step
	    var now = this._clock.now(); 
	    var initVector = this._to.vector;

	    if (this._isReady() === false) {
			// Initial update from timing object starts the sequencer
			this._schedule = new Schedule(now);
			// Register handler on axis
			this._axis.on("change", this._wrappedOnAxisChange, this);
	    } else {
	    	// Deliberately set time (a little) back for delayed updates
	    	now = initVector.timestamp;
	    	// Empty schedule
	    	this._schedule.advance(now); 
	    }

	    /*
	      Re-evaluate non-singularities
	      This is strictly not necessary after vector changes that
          preserve position. However, for simplicity we
	      re-evaluate intervals whenever vector changes.
	    */
	    var nowVector = motionutils.calculateVector(initVector, now);
	    var oldKeys = this._activeKeys;
	    var newKeys = this._axis.lookupByPoint(nowVector.position).map(function (item) {
	    	return item.key;
	    });
	    var exitKeys = unique(oldKeys, newKeys);
	    var enterKeys = unique(newKeys, oldKeys);



	    /*
			Corner Case: Exiting Singularities
			and
			Exiting closed intervals ]
			and 
			Entering open intervals <
	    */
	    var _isMoving = isMoving(initVector);
	    if (_isMoving) {
	    	var nowPos = nowVector.position;
		    var points = this._axis.lookupByInterval(new Interval(nowPos, nowPos, true, true));
		    points.forEach(function (pointInfo) {
		    	// singularities
				if (pointInfo.pointType === axis.PointType.SINGULAR) {
				    exitKeys.push(pointInfo.key);
				} else {
					// closed interval?
					var interval = pointInfo.interval;
					var closed = false;
					if (pointInfo.pointType === axis.PointType.LOW && interval.lowInclude) {
						closed = true;
					} else if (pointInfo.pointType === axis.PointType.HIGH && interval.highInclude) {
						closed = true;
					}
					// exiting or entering interval?
					var direction = DirectionType.fromInteger(motionutils.calculateDirection(initVector, now));
					var entering = true;						
					if (pointInfo.pointType === axis.PointType.LOW && direction === DirectionType.BACKWARDS)
						entering = false;
					if (pointInfo.pointType === axis.PointType.HIGH && direction === DirectionType.FORWARDS)
						entering = false;
					// exiting closed interval
					if (!entering && closed) {
						exitKeys.push(pointInfo.key);
					}
					// entering open interval
					if (entering && !closed) {
						enterKeys.push(pointInfo.key);
					}
				}
		    }, this);
	    }

	  
	    /* 
	    	Note : is it possible that a key for singularity
	    	may be in both enterKeys and exitKeys? 
	    	- only in the corner case of movement and evaluation at eaxctly the point
	    	where the singularity lies - have duplicate protection elsewhere - ignore
		*/
	   
	    var exitItems = exitKeys.map(function (key) {
	    	return {key:key, interval: this._axis.getIntervalByKey(key), data: this.getData(key)};
	    }, this);
	    var enterItems = enterKeys.map(function (key) {
	    	return {key:key, interval: this._axis.getIntervalByKey(key), data: this.getData(key)};
	    }, this);
	    // Trigger interval events
	    this._processIntervalEvents(now, exitItems, enterItems, []);


	    /*
	      	Rollback falsely reported events
	      	Non-singular Intervals entered/left wrongly before update was sorted out above.
	      	- So far we do not roll back events. 
	    */

        /* 
        	Re-creating events lost due to network latency in timing object changes. 
        	This is achieved by advancing and loading from <now> which is derived 
        	from update vector rather than an actual timestamp. 
        */

	    // Kick off main loop
    	this._load(now);
    	this._main(now);
	};



	/*
	  UPDATE

	  Updates the axis. Updates have further effect
	  if they relate to intervals within the immediate future.  
	  This roughly corresponds to the covering
	  time-interval and covering position-interval.

		- EVENTS (i.e. singular intervals)
	  
	  Relevant events for the sequencer are those that apply to the immediate future
	  i.e. the Schedule.

	  - removed events may have to be invalidated if they were due in immediate future
	  - new events may be added to the schedule if due in immedate future

	  - INTERVALS
	  Relevant interval changes trigger exit or enter events,
	  and since their relevance is continuous they will be delayed
	  no matter how late they are, as long as the interval update is
	  relevant for the current position of the timing object.
	 */

	Sequencer.prototype.updateAll = function(argList) {
		this._axis.updateAll(argList);
	};


	Sequencer.prototype._onAxisChange = function (origOpList) {
		var i, e, key, interval, data;	

		// filter out NOOPs
		var opList = origOpList.filter(function (op) {
			return (op.type !== axis.OpType.NOOP);
		});	

		// axis is updated - update scheduler
	    var now = this._clock.now();
	    var nowVector = motionutils.calculateVector(this._to.vector, now);
	    var nowPos = nowVector.position;

	    // EXIT and ENTER Intervals
	    var enterItems = []; // {key:key, interval:interval}
	    var exitItems = []; // {key:key, interval:interval}
	    var isActive, shouldBeActive;
	    opList.forEach(function (op) {
	    	interval = op.interval;
	    	key = op.key;
		    /*
		      	Re-evaluate active intervals. Immediate action is required only if 
			    a interval was active, but no longer is -- or the opposite.

				Singularity intervals may not be ignored here - as a singluarity 
				might have been an active interval and just now collapsed
				into a singularity
		    */
		    isActive = this.isActive(key);
		    shouldBeActive = false;
		    if (op.type === axis.OpType.CREATE || op.type === axis.OpType.UPDATE) {
		    	if (interval.coversPoint(nowPos)) {
					shouldBeActive = true;
		    	}
		    }
		    // set data element
		    if (op.type === axis.OpType.REMOVE) {
		    	data = op.data 
		    } else {
		    	data = op.data || this.getData(key)
		    }

		    if (isActive && !shouldBeActive) {
		    	
				exitItems.push({key:key, interval:interval, data: data});
			} else if (!isActive && shouldBeActive) {
				enterItems.push({key:key, interval:interval, data: data});
		    }
	    }, this);


		/* 
			changes events
			generate change events for currently active spans, which did change, 
			but remained active - thus no enter/exit events will be emitted).
		
			these are items that are active, but not in enterItems list
			including NOOP operation (change in non-temporal sense)
		*/
		var changeItems = origOpList.
			filter (function (op) {
				return (this.isActive(op.key) && enterItems.indexOf(op.key) === -1);
			}, this).
			map (function (op) {
				return {key: op.key, interval: op.interval, data: op.data};
			}, this);



		// INVALIDATE events in the SCHEDULE
		/*
	      Re-evaluate the near future. The schedule may include
	      tasks that refer to these keys. These may have to
	      change as a result of intervals changing. 

	      Simple solution:
	      - invalidate all tasks in the schedule
	      - most of them wont be in the schedule
	      - invalidate even if the timing object is not moving
	    
			if timing object is not moving, the schedule may not have been advanced in a while
			simply advance it - to empty it - as an effective way of invalidation
		*/
		var _isMoving = isMoving(nowVector);
		if (!_isMoving) {
			// not moving - not sure this is necessary
			this._schedule.advance(now);
		} else {
			// moving - invalidate all events - possibly advance is just as good
			opList.forEach(function (op) {
				this._schedule.invalidate(op.key);
			}, this);

			// RELOAD events into the SCHEDULE
			var point, reloadPoints = [];
			opList.forEach(function (op) {
				interval = op.interval;
	    		key = op.key;

	    		// Nothing to reload for remove events
		    	if (op.type === axis.OpType.REMOVE) {
					return;
		    	}

				/* 
			       Corner Case: If the new interval is singularity, and if it
			       happens to be exactly at <nowPos>, then it needs to be
			       fired. 
			    */

			    // Reload only required if the msv is moving
				if (_isMoving) {
					/*
				      Load interval endpoints into schedule			      
				      The interval has one or two endpoints that might or might not be
				      relevant for the remainder of the current time-interval of the schedule.
				      Check relevance, i.t. that points are within the
				      position range of the schedule.
				    */
					var item = {key: key, interval: interval}; 
				    var rangeInterval = this._schedule.getPosInterval();
				    if (rangeInterval !== null) {
				    	if (rangeInterval.coversPoint(interval.low)) {
				    		item.point = interval.low;
				    	} 
				    	if (rangeInterval.coversPoint(interval.high)) {
				    		item.point = interval.high;
				    	}
				    	item.pointType = this._axis.getPointType(item.point, item.interval);
				    	reloadPoints.push(item);
				    }
				}
			}, this);

		   	// reload relevant points
		    if (reloadPoints.length > 0) {
				this._load(now, reloadPoints);
		    }
		}
	
		// break control flow with setTimeout so that events are emitted after addCue has completed
		var self = this;
		setTimeout(function () {
			// notify interval events and change events
			self._processIntervalEvents(now, exitItems, enterItems, changeItems);
			// kick off main loop
			self._main(now);
		}, 0);
	
	};


	/*
        Sequencer core loop, loops via the timeout mechanism as long
        as the timing object is moving.
	*/
	Sequencer.prototype._main = function (now) {
		var eList;
	    // cancel_timeout
	    if (this._timeout !== null) {
			this._timeout.cancel();
			this._timeout = null;
	    }
	    now = now || this._clock.now();
	    // process tasks (empty due tasks from schedule)
        eList = this._processScheduleEvents(now, this._schedule.pop(now));
        this.eventifyTriggerEvents(eList);
        // advance schedule window
        var _isMoving = isMoving(this._to.vector);
        if (_isMoving && this._schedule.isExpired(now)) {		
			now = this._schedule.getTimeInterval().high;
            this._schedule.advance(now);
            this._load(now);
            // process tasks again
            eList = this._processScheduleEvents(now, this._schedule.pop(now));
	    	this.eventifyTriggerEvents(eList);
	    }
        // set timeout if moving
        if (_isMoving) {
        	var secAnchor = this._clock.now();	
			var secDelay = this._schedule.getDelayNextTs(secAnchor); // seconds
			var self = this;
			this._timeout = this._clock.setTimeout(function () {
				self._main();
			}, secDelay, {anchor: secAnchor, early: 0.0005});
	    }
	};


	/* 
	   LOAD

       Sequencer loads a new batch of points from axis into
       the schedule

       If given_points is specified, this implies that the
       points to load are known in advance. This is the case when
       axis is being updated dynamically during execution. If
       points are not known the load function fetches points from
       the axis by means of the time cover of the schedule.

	   load only makes sense when timing object is moving
	*/

	Sequencer.prototype._load = function (now, givenPoints) {
		var initVector = this._to.vector;
	    if (!isMoving(initVector)) {
			return;
	    }


	    /* 
	       MOVING
	       Load events from time interval
	    */
	    var timeInterval = this._schedule.getTimeInterval();
	    var tStart = timeInterval.low;
	    var tEnd = timeInterval.high;
	    var tDelta = tEnd - tStart;
	    // range
		var range = this._to.range;
	    var vectorStart = motionutils.calculateVector(initVector, tStart);
	    var points = givenPoints;

	    // Calculate points if not provided
	    if (!points) {
			// 1) find the interval covered by the movement of timing object during the time delta
			var posRange = motionutils.calculateInterval(vectorStart, tDelta);
			var pStart = Math.max(posRange[0], range[0]);
			var pEnd = Math.min(posRange[1], range[1]);
			var posInterval = new Interval(pStart, pEnd, true, true);
			this._schedule.setPosInterval(posInterval);

			// 2) find all points in this interval
			points = this._axis.lookupByInterval(posInterval);
	    }

	    /*
			Add data to points
	    */
	    points.forEach(function (pointInfo){
	    	pointInfo.data = this.getData(pointInfo.key);
	    }, this);

	    /*
	      Note : 1) and 2) could be replaced by simply fetching
	      all points of the axis. However, in order to avoid
	      calculating time intercepts for a lot of irrelevant points, we
	      use step 1) and 2) to reduce the point set.
	    */
	    
	    // create ordered list of all events for time interval t_delta 
	    var eventList = motionutils.calculateSolutionsInInterval(vectorStart, tDelta, points);
	    
	    /* 
	       SUBTLE 1 : adjust for range restrictions within
	       time-interval tasks with larger delta will not be
	       pushed to schedule it is not necessary to truncate the
	       time interval of schedule similarly - just drop all
	       events after prospective range violations. <rDelta> is
	       time to (first) range violation
	    */	    
	    var rDelta = motionutils.calculateDelta(vectorStart, range)[0];
	  
 	    /* 
	       SUBTLE 2: avoid tasks exactly at start of time-interval
	       assume that this point should already be processed by the
	       previous covering interval.
	    */
	    
	    // filter and push events on sched
	    eventList.forEach(function (e)  {

	    	var d = e[0];
			var task = e[1];
			var push = true;
			
			/* 
			   drop events exactly at the start of the time covering
			   interval. 
			*/
			if (d === 0) {
			    push = false; 
			}
			/* 
			   drop all events scheduled after (in time) range
			   violation should occur
			*/
			if (d > rDelta) {
				push = false;  
			}
			/*
			  event scheduled exactly at range point.
			  - interval : 
			  Exiting/entering a interval should not happen at range point - drop
			*/
			if (d === rDelta) {
			    push = false;
			}
			
			/* 
			   check if we are touching an interval without
			   entering or exiting. Note that direction will
			   not be zero at this point, because direction
			   includes acceleration, which is not zero in
			   this case.
			   drop all interval events that have zero velocity
			   at the time it is supposed to fire
			*/
			if (task.pointType === axis.PointType.LOW || task.pointType === axis.PointType.HIGH) {
			    var v = motionutils.calculateVector(initVector, tStart + d);
			    if (v.velocity === 0){
					push = false;
			    }
			}
			// push
			if (push) {		    
			    this._schedule.push(now, tStart + d, task);
			} 
	    }, this); 
	};


	/*
		Helper function to make event messages
	*/
	Sequencer.prototype._makeEArgs = function(key, interval, data, directionInt, verbType, point, ts, dueTs) {
		var directionType = DirectionType.fromInteger(directionInt);
		var pointType = this._axis.getPointType(point, interval);
		if (verbType === undefined) {
			var pointInt = axis.PointType.toInteger(pointType);
			var verbInt = pointInt * directionInt * -1;
			verbType = VerbType.fromInteger(verbInt);
		}
		return new SequencerEArgs(this, key, interval, data, point, pointType, ts, dueTs, directionType, verbType);
	};


	// Process point events originating from the schedule
	Sequencer.prototype._processScheduleEvents = function (now, eventList) {
	   	var msg, msgList = [];	   		
	   	var nowVector = motionutils.calculateVector(this._to.vector, now);
   		var directionInt = motionutils.calculateDirection(nowVector, now);
		var ts = this._clock.now(); 
	    eventList.forEach(function (e) {
			if (e.task.interval.isSingular()) {
				// make two event messages for singular
				msg = this._makeEArgs(e.task.key, e.task.interval, e.task.data, directionInt, VerbType.ENTER,e.task.point, ts, e.ts);
				msgList.push(msg);
				msg = this._makeEArgs(e.task.key, e.task.interval, e.task.data, directionInt, VerbType.EXIT,e.task.point, ts, e.ts);
				msgList.push(msg);
			} else {				
		    	msg = this._makeEArgs(e.task.key, e.task.interval, e.task.data, directionInt, undefined, e.task.point, ts, e.ts);
		    	msgList.push(msg);	
			}			
	    }, this);
	    return this._makeEvents(now, msgList);
	};

	// Process interval events orignating from axis change, timing object change or active keys
	Sequencer.prototype._processIntervalEvents = function (now, exitItems, enterItems, changeItems) {
	    if (exitItems.length + enterItems.length + changeItems.length === 0) {
			return;
	    }
	    var nowVector = motionutils.calculateVector(this._to.vector, now);
		var directionInt = motionutils.calculateDirection(nowVector, now);
		var ts = this._clock.now(); 
	    var msgList = [];
    	// trigger events
    	exitItems.forEach(function (item){
			msgList.push(this._makeEArgs(item.key, item.interval, item.data, directionInt, VerbType.EXIT, nowVector.position, ts, now));
		}, this); 
		enterItems.forEach(function (item){
			msgList.push(this._makeEArgs(item.key, item.interval, item.data, directionInt, VerbType.ENTER, nowVector.position, ts, now));
		}, this);
		changeItems.forEach(function (item) {
			msgList.push(this._makeEArgs(item.key, item.interval, item.data, directionInt, VerbType.CHANGE, nowVector.position, ts, now));
		}, this);
		this.eventifyTriggerEvents(this._makeEvents(now, msgList));
	};


	Sequencer.prototype._processInitialEvents = function () {
		// called by makeInitEvents - return event list based on activeKeys
		var interval, data, eArg;
		var now = this._clock.now();
		var nowVector = motionutils.calculateVector(this._to.vector, now);
		var directionInt = motionutils.calculateDirection(nowVector, now);
		var ts = this._clock.now();
		return this._activeKeys.map(function (key) {
			interval = this._axis.getIntervalByKey(key);
			data = this.getData(key);
			eArg = this._makeEArgs(key, interval, data, directionInt, VerbType.ENTER, nowVector.position, ts, now);
			return {type: VerbType.ENTER, e: eArg}; 
		}, this);
	};

	
	/*
		make events ensures consistency of active keys as changes
		to active keys are driven by actual notifications
	*/

	Sequencer.prototype._makeEvents = function (now, msgList) {
		if (msgList.length === 0) {
			return [];
		}
		// manage active keys
		var index, eventList = [];
		msgList.forEach(function (msg) {
			// exit interval - remove keys 
		    if (msg.type === VerbType.EXIT) {
				index = this._activeKeys.indexOf(msg.key);
				if (index > -1) {
			    	this._activeKeys.splice(index, 1);		
				}
		    }
		    // enter interval - add key
		    if (msg.type === VerbType.ENTER) {
				index = this._activeKeys.indexOf(msg.key);
				if (index === -1) {
				    this._activeKeys.push(msg.key);
				} 
		    }
		    eventList.push(msg);
		}, this);
		// make sure events are correctly ordered
		eventList = this._reorderEventList(eventList);
		// finalise events
		return eventList.map(function (item) {
			return {type: item.type, e:item};
		});	    	    
	};

	/*
		Event list is sorted by time. 
		There can be multiple events on the same time.
		Events with the same point (thus time) need to be sorted according to the following precedence
		a. exit interval > (interval does not include exit-point)
		x. enter interval [ (interval includes enter-point)
		b. enter singular
		c. exit singular			
		y. exit intervals ] (interval includes exit-point)
		d. enter intervals < (interval does not include enter-point)
	*/
	Sequencer.prototype._reorderEventList = function (msgList) {
		if (msgList.length < 2) return msgList;
		// stack events per point
		var point, dueTs, newList = [];
		var s = {"a": [], "x": [], "b": [], "c": [], "y": [], "d": []};
		msgList.forEach(function(msg) {
			// new point - pop from stack
			if (msg.point !== point || msg.dueTs !== dueTs) {
				newList = newList
					.concat(s["a"])
					.concat(s["x"])
					.concat(s["b"])
					.concat(s["c"])
					.concat(s["y"])
					.concat(s["d"]);
				s = {"a": [], "x": [], "b": [], "c": [], "y": [], "d": []};
				point = msg.point;
				dueTs = msg.dueTs;
			}
			// push on stack
			if (msg.pointType === axis.PointType.SINGULAR) {
				if (msg.type === VerbType.ENTER) {
					// enter singular
					s["b"].push(msg);
				} else {
					// exit singular
					s["c"].push(msg);
				}
			} else {
				/* 
					Interval
					special ordering when we enter or exit interval
					through endpoint (low or high) and this endpoint is CLOSED ] as opposed to OPEN >
				*/
				var closed = false;
				if ((msg.pointType === axis.PointType.LOW) && msg.interval.lowInclude) {
					closed = true;
				} else if ((msg.pointType === axis.PointType.HIGH) && msg.interval.highInclude) {
					closed = true;
				}
				if (msg.type === VerbType.ENTER) {
					// enter interval
					if (closed) s["x"].push(msg);
					else s["d"].push(msg);
				} else {
					// exit interval
					if (closed) s["y"].push(msg);
					else s["a"].push(msg);
				}
			}
		}, this);

		// pop last from stack
		return newList
				.concat(s["a"])
				.concat(s["x"])
				.concat(s["b"])
				.concat(s["c"])
				.concat(s["y"])
				.concat(s["d"]);
	};

	
    // get request builder object
	Sequencer.prototype.request = function () {
		return new Builder(this);
	};

	// TODO : force SequencerCue object on input?
	Sequencer.prototype.addCue = function (key, interval, data) {
		return this.updateAll([{key:key, interval:interval, data: data}]);
	};

	Sequencer.prototype.removeCue = function (key, removedData) {
		return this.updateAll([{key:key, interval:undefined, data:removedData}]);
	};

	// true if cues exists with given key
	Sequencer.prototype.hasCue = function (key) {
		return this._axis.hasKey(key);
	};

	// Get all keys
	Sequencer.prototype.keys = function () {
		return this._axis.keys();
	};
	
	// get specific cue {key: key, interval:interva} given key
	Sequencer.prototype.getCue = function (key) {
		if (this._axis.hasKey(key)) {
			return new SequencerCue (key, this._axis.getIntervalByKey(key), this.getData(key));
		}  
	};

	// get all cues
	Sequencer.prototype.getCues = function () {
		return this.keys().map(function (key) {
			return this.getCue(key);
		}, this);
	};

	// return true if cue of given key is currently active
	Sequencer.prototype.isActive = function (key) {
	    return (this._activeKeys.indexOf(key) > -1);
	};

	// Get keys of active cues
	Sequencer.prototype.getActiveKeys = function () {
		// copy keys
		var res = [];
		this._activeKeys.forEach(function (key) {
			res.push(key);
		}, this);
		return res;
	};

	Sequencer.prototype.getActiveCues = function () {
		var res = [];
		this._activeKeys.forEach(function (key) {
			res.push(this.getCue(key));
		}, this);
		return res;
	};


	// return all (key, inteval, data) tuples, where interval covers point
	Sequencer.prototype.getCuesByPoint = function (point) {
		return this._axis.lookupByPoint(point).map(function (item) {
			return this.getCue(item.key);
		}, this);
	};

	// return all cues with at least one endpoint within searchInterval
	Sequencer.prototype.getCuesByInterval = function (searchInterval) {
		// keys may be mentioned for 2 points in searchInterval - use dict to avoid duplicating intervals
		var _dict = {};
		this._axis.lookupByInterval(searchInterval).forEach(function (pointInfo) {
			_dict[pointInfo.key] = pointInfo.interval;
		});
		return Object.keys(_dict).
			map(function(key){
				return this.getCue(key);
			}, this).
			filter(function (cue) {
				return (searchInterval.overlapsInterval(cue.interval));
			}, this);
	};

	// return all cues covered by searchInterval
	Sequencer.prototype.getCuesCoveredByInterval = function (searchInterval) {
		return this.getCuesByInterval(searchInterval).filter(function (cue) {
			return (searchInterval.coversInterval(cue.interval)) ? true : false;
		}, this);
	};

	// shutdown
	Sequencer.prototype.close = function () {
	    this._to.off("change", this._wrappedOnTimingChange, this);
	    this._axis.off("change", this._wrappedOnAxisChange, this);
	    if (this._timeout !== null) {
			this._timeout.cancel();
			this._timeout = null;		
	    }
	};


	// Inherit function used for specialized sequencers.
	var inherit = function (Child, Parent) {
		var F = function () {}; // empty object to break prototype chain - hinder child prototype changes to affect parent
		F.prototype = Parent.prototype;
		Child.prototype = new F(); // child gets parents prototypes via F
		Child.uber = Parent.prototype; // reference in parent to superclass
		Child.prototype.constructor = Child; // resetting constructor pointer 
	};

	// Module Definition
	return {
		inherit : inherit,
		Interval : Interval,
		Sequencer : Sequencer,
		Axis : axis.Axis,
		SequencerError : SequencerError,
	};

});



