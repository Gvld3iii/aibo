def calculate_average(numbers)
    total = 0
    for num in numbers
        total += num
    return total / len(numbers

result = calculate_average([10, 20, 30, 40, 50])
print("Average:" result)